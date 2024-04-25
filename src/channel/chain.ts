import { UserType } from "@libs/constants/user.const";
import { StatusError } from "@libs/errors/StatusError";

import { Storage } from "@libs/s3/s3.util";
import { KeyValue, constructAction, validateAction } from "@libs/security/action";
import { extractPath } from "@libs/storage.util";
import { EndpointSchema, IUserLevel, Uploads } from "@models/user-level.model";
import { IP, UserDocument } from "@models/user.model";
import { MaybePromise } from "elysia";
import { capitalize, cloneDeepWith, get, isEmpty } from "lodash-es";
import { FilterQuery, QueryOptions } from "mongoose";
import NodeCache from "node-cache";

export interface Chain {
  /**
   * @throws {StatusError} If a user doesn't have the right to perform an action.
   * @param baseAction The base action name. It is basically the model name.
   * @returns {Chain} A the Chain object that let you call the perform method to check data against defined schema or you can call other methods.
   */
  checkAction(baseAction?: string): Chain;

  /**
   * @throws {StatusError} If the current authenticated user is not the expected user type.
   * @param {UserType[]} userType list of user types that are allowed.
   * @returns {Chain} let you call the perform to check data against defined schema or other methods.
   */
  checkUser(currentUserType: UserType, allowedUsers: UserType[]): Chain;

  /**
   *
   * @param callback Perform any task and return a boolean as the result.
   * @param msg Provide a message in case the callback returns false.
   * @returns The chain to let you call other methods.
   */
  predicate(callback?: () => MaybePromise<boolean>, msg?: string): Chain;

  /**
   * Checks if any specified keys exist on the provided body.
   * @param keys list of keys to check in request body.
   * @param prefixAction An optional prefix for action e.g. Change
   * @returns Chain to let you call other methods.
   */
  checkIfKeysExist(keys?: string[], prefixAction?: string, shouldDelete?: boolean): Chain;

  /**
   * Checks if the provided request body has the record.
   * @param record The record [key: value] to check in body.
   * @param prefixAction An optional prefix for action.
   * @returns Chain to let you call other methods.
   */
  checkIfKeysValueExist(record?: KeyValue, prefixAction?: string, shouldDelete?: boolean): Chain;

  /**
   * This method specify whether visitor user can visit this endpoint.
   * @param can true means a visitor can visit and access the endpoint, false throw unauthorized error.
   * @throws {StatusError} throws an error to indicated unauthorized status of visitor.
   */
  visitorVisit(can: boolean): Chain;

  checkIfUserIs(users: UserType[]): Chain;

  /**
   *
   * @param windows  Time window for rate limiting in seconds
   * @param max Maximum number of requests allowed per time window
   */
  checkRateLimit(windows: number, max: number): Chain;

  postPerform(callback: () => MaybePromise<any>);

  /**
   * This is the last method called in the Chain.
   */
  perform<T>(): Promise<ChainResult<T>>;
}

type Retry = {
  count: number;
  retry: number;
};

export abstract class BaseChain implements Chain {
  callback?: MaybePromise<boolean>;
  callbackMsg?: string;

  endpoint?: EndpointSchema;
  actions: string[];

  constructor(
    protected iModel: Function,
    protected user: UserDocument,
    protected path: string,
    protected prefix?: string,
    protected baseAction?: string,
    protected cache?: NodeCache,
    protected ip?: IP
  ) {
    const level = this.user?.level as IUserLevel;

    this.endpoint = get(level?.access?.endpoints, path);

    logger.log("info", { path, user: user?.type });
    this.actions = level?.actions || [];

    if (cache && ip && this.endpoint?.rateLimit) {
      this.checkRateLimit(this.endpoint.rateLimit.ttl, this.endpoint.rateLimit.max);
    }

    if (!this.endpoint?.canVisitorVisit) {
      this.visitorVisit(false);
    }

    if (this.endpoint?.shouldCheckAction !== false) {
      this.checkAction(this.endpoint?.baseAction || this.baseAction);
    }

    if (!isEmpty(this.endpoint?.allowedUsers)) {
      this.checkIfUserIs(this.endpoint?.allowedUsers!);
    }
  }

  predicate(callback?: () => MaybePromise<boolean>, msg?: string): Chain {
    if (callback) {
      this.callback = callback();
      this.callbackMsg = msg;
    }
    return this;
  }

  checkAction(baseAction?: string): Chain {
    const base = baseAction || this.baseAction || this.endpoint?.baseAction;
    this.baseAction = this.baseAction || base;

    if (!base) throw new Error("You have not set a base action to check.");

    const action = constructAction(base, this.prefix);
    validateAction(action, this.actions);
    return this;
  }

  checkUser(currentUserType: UserType, allowedUsers: UserType[]): Chain {
    if (!allowedUsers.includes(currentUserType))
      throw new StatusError(403, "Invalid Account", "Sorry, your account is not able to perform this action.");
    return this;
  }

  protected async prePerform() {
    if (this.callback !== undefined) {
      const result = this.callback instanceof Promise ? await this.callback : this.callback;
      if (!result)
        throw new StatusError(
          403,
          "Predicate Not Succeeded",
          this.callbackMsg || "You are not allowed to process further, because the provided predicate mismatches."
        );
    }
  }

  _checkIfKeysExist(obj?: Record<string, any>, keys?: string[], prefixAction?: string, shouldDelete: boolean = false): Chain {
    if (!obj || !keys) return this;

    for (const key of keys) {
      if (obj[key]) {
        if (shouldDelete) {
          delete obj[key];
          continue;
        }
        const action = constructAction(
          this.baseAction || this.endpoint?.baseAction!,
          this.prefix,
          capitalize(key),
          prefixAction
        ).trim();
        validateAction(action, this.actions, obj[key]);
      }
    }

    return this;
  }

  _checkIfKeysValueExist(
    obj?: Record<string, any>,
    record?: KeyValue,
    prefixAction?: string,
    shouldDelete: boolean = false
  ): Chain {
    if (!obj || !record) return this;

    for (const key of Object.keys(record)) {
      if (obj[key]) {
        const match =
          typeof record[key] === "string"
            ? obj[key] === record[key]
            : (record[key] as string[]).some((value) => value === obj[key]);
        if (match) {
          if (shouldDelete) {
            delete obj[key];
            continue;
          }
          const action = constructAction(
            this.baseAction || this.endpoint?.baseAction!,
            this.prefix,
            capitalize(key),
            prefixAction
          );
          validateAction(action, this.actions, obj[key]);
        }
      }
    }
    return this;
  }

  checkIfUserIs(users: UserType[]): Chain {
    if (!users.includes(this.user!.type!))
      throw new StatusError(403, "Invalid Account", "Sorry, your account is not able to perform this action.");
    return this;
  }

  visitorVisit(canVisit: boolean): Chain {
    if (!canVisit && this.user.type === UserType.Visitor)
      throw new StatusError(401, "Unauthorized", "You need to login to access this service.");
    return this;
  }

  checkRateLimit(windows: number, max: number): Chain {
    if (!this.ip || !this.cache) return this;

    const key = `${this.path}-${this.ip?.address}`;

    const retryKey = key + "-retry";
    if (this.cache.has(key)) {
      const count = this.cache.get<number>(key)!;
      if (count === 0) {
        if (this.cache.has(retryKey)) {
          const retry = this.cache.get<Retry>(retryKey)!;
          if (retry.count === 0) {
            retry.retry += 1;
            retry.count = 2 * max - 1;
            this.cache.set(retryKey, retry, windows);
            this.cache.set(key, 0, windows * retry.retry);
          } else {
            retry.count -= 1;
            this.cache.set(retryKey, retry, windows);
          }
        } else {
          // user has tried suspiciously
          const retry: Retry = { retry: 1, count: max * 2 - 1 };
          this.cache.set(retryKey, retry, windows);
        }

        throw new StatusError(429, "Too Many Request", "You have exceeded the the number of request at this endpoint.");
      }

      const ttl = this.cache.getTtl(key)!;
      const newTtl = (ttl - Date.now()) / 1000;
      this.cache.set(key, count - 1, newTtl);
    } else {
      this.cache.has(retryKey) && this.cache.del(retryKey);
      this.cache.set(key, max - 1, windows);
    }
    return this;
  }

  protected setCurrentUser(data: any, callback?: (key: string, value: any) => void, stringify = false) {
    return cloneDeepWith(data, (value, key) => {
      callback && key && callback(key?.toString(), value);
      if (value === "*current_user*") {
        return stringify ? this.user?._id?.toString() : this.user?._id;
      }
    });
  }

  async postPerform(callback: () => MaybePromise<any>) {
    const result = callback();
    return result instanceof Promise ? await result : result;
  }

  abstract checkIfKeysExist(keys?: string[], prefixAction?: string, shouldDelete?: boolean): Chain;
  abstract checkIfKeysValueExist(record?: KeyValue, prefixAction?: string, shouldDelete?: boolean): Chain;

  abstract perform<T>(): Promise<ChainResult<T>>;
}

export type ChainResult<T> = {
  doc: T;
  options: QueryOptions;
};
export type ReadChainResult<I> = ChainResult<I> & {
  filter: FilterQuery<I>;
};
