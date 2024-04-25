import { StatusError } from "@libs/errors/StatusError";
import { KeyValue } from "@libs/security/action";
import { makeQuery, makeQueryOption, parseNestedObject, parseObject } from "@libs/utility";
import { IP, UserDocument } from "@models/user.model";
import Ajv from "ajv";
import { isEmpty, isUndefined, omitBy, set } from "lodash-es";
import NodeCache from "node-cache";
import { FindFilter } from "room/query/types";
import { BaseChain, Chain, ReadChainResult } from "./chain";
import { validatePopulatePrivateFields } from "./channel.util";
import { logger } from "@libs/logger";
import { validateDataSchema } from "./DataValidationSchema";

export default class ReadChain<I> extends BaseChain {
  constructor(
    iModel: Function,
    private filter: FindFilter<I>,
    user: UserDocument,
    path: string,
    baseAction?: string,
    cache?: NodeCache,
    ip?: IP
  ) {
    super(iModel, user, path, "Read", baseAction, cache, ip);
  }

  checkIfKeysExist(deniedKeys?: string[], prefixAction?: string | undefined, shouldDelete: boolean = false): Chain {
    const keys = this.endpoint?.query?.deniedKeys || deniedKeys;
    return this._checkIfKeysExist(this.filter, keys, prefixAction, shouldDelete);
  }

  checkIfKeysValueExist(record?: KeyValue, prefixAction?: string | undefined, shouldDelete: boolean = false): Chain {
    const keys = this.endpoint?.query?.deniedKeysValue || record;
    return this._checkIfKeysValueExist(this.filter, keys, prefixAction, shouldDelete);
  }

  protected async prePerform(): Promise<void> {
    await super.prePerform();

    if (this.endpoint?.query?.deniedKeys) this._checkIfKeysExist(this.filter, this.endpoint.query.deniedKeys, undefined, true);

    if (this.endpoint?.query?.deniedKeysValue)
      this._checkIfKeysValueExist(this.filter, this.endpoint.query.deniedKeysValue, undefined, true);

    this.filter = parseNestedObject(this.filter);
    if (this.endpoint?.query?.schemas) {
      // this validate filter against the defined schema

      const { defaultValue, errors, isValid, defaultOption } = validateDataSchema(
        this.filter,
        this.setCurrentUser(this.endpoint?.query?.schemas, undefined, true),
        this.endpoint?.query?.default,
        this.endpoint?.query?.options
      );

      if (!isValid) {
        let msg = `The query you provided is not allowed by the system.`;
        if (errors) msg = `The query you provided is not allowed by the system. Your query ${errors[errors!.length - 1].message}`;

        throw new StatusError(403, "Restricted Query", msg, errors);
      }
      set(this.endpoint?.query, "default", defaultValue);
      set(this.endpoint?.query, "options", defaultOption);
    }
  }

  async perform<T = ReadChainResult<I>>(): Promise<T> {
    await this.prePerform();

    const { itemsCount, page, projection, sort, populate, ..._filter } = this.filter;

    const defaultFilter = this.endpoint?.query?.default ? this.setCurrentUser(this.endpoint?.query?.default) : undefined;

    const filter = makeQuery(_filter, defaultFilter as any, this.endpoint?.query?.merge, this.endpoint?.query?.isPrior);
    let pop = parseObject(populate);
    let newPop: any[] | undefined = undefined;
    if (!isEmpty(pop)) {
      newPop = [];
      if (!Array.isArray(pop)) pop = [pop];
      for (let p of pop) {
        newPop.push(parseObject(p));
      }
    }
    const userOptions = omitBy(
      { itemsCount, page, projection, sort, populate: validatePopulatePrivateFields(this.iModel, newPop) },
      isUndefined
    );
    const options = makeQueryOption(userOptions, this.endpoint?.query?.options);

    logger.info("query with filter", { filter, options });
    return { filter, options } as T;
  }
}

0;
