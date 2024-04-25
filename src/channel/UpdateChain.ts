import ajv from "@libs/ajv/ajv";
import { StatusError } from "@libs/errors/StatusError";
import { logger } from "@libs/logger";
import { moveFieldsFile } from "@libs/s3/s3.util";
import { KeyValue } from "@libs/security/action";
import { makeQuery } from "@libs/utility";
import { Uploads } from "@models/user-level.model";
import { IP, UserDocument } from "@models/user.model";
import { isEmpty, merge, uniqBy } from "lodash-es";
import { FilterQuery, UpdateQuery } from "mongoose";
import NodeCache from "node-cache";
import { BaseChain, Chain, ChainResult } from "./chain";

export type UpdateChainResult<I> = ChainResult<I> & {
  filter: FilterQuery<I>;
  update: UpdateQuery<I>;
};

export default class UpdateChain<I> extends BaseChain {
  constructor(
    iModel: Function,
    private filter: FilterQuery<I>,
    private update: UpdateQuery<I>,
    user: UserDocument,
    path: string,
    baseAction?: string,
    cache?: NodeCache,
    ip?: IP
  ) {
    super(iModel, user, path, "Update", baseAction, cache, ip);
  }
  async perform<T = UpdateChainResult<I>>(): Promise<T> {
    await this.prePerform();

    let tempUploads: Uploads[] = [];

    const uploadFile = (key: string, value: any) => {
      if (key.endsWith("_file_url") && typeof value === "string") {
        tempUploads.push({
          field: key,
          acl: "authenticated-read",
          directory: `users/${this.user._id?.toString()}/${this.baseAction}`,
        });
      }
    };

    const body = this.setCurrentUser(this.update, uploadFile);

    let files = {};

    let uploads = this.endpoint?.body?.uploads || [];

    uploads = uploads.map((u) => ({
      ...u,
      directory: u.directory
        .replaceAll("*current_user*", this.user?._id!.toString())
        ?.replaceAll("*current_model*", this.filter?._id),
    }));

    tempUploads.unshift(...uploads);
    tempUploads = uniqBy(tempUploads, "field");

    if (!isEmpty(tempUploads)) {
      files = await moveFieldsFile(tempUploads, this.update);
    }

    const defaultFilter = this.endpoint?.query?.default ? this.setCurrentUser(this.endpoint?.query?.default) : undefined;

    const filter = makeQuery(this.filter, defaultFilter as any, this.endpoint?.query?.merge, this.endpoint?.query?.isPrior);

    const update = merge({}, body, files);
    logger.info("Running Update Operation", { filter, update });

    return {
      filter,
      update,
      options: this.endpoint?.query?.options || { new: true },
    } as T;
  }

  protected async prePerform(): Promise<void> {
    await super.prePerform();

    if (this.endpoint?.query?.deniedKeys) this._checkIfKeysExist(this.filter, this.endpoint.query.deniedKeys, undefined, true);

    if (this.endpoint?.query?.deniedKeysValue)
      this._checkIfKeysValueExist(this.filter, this.endpoint.query.deniedKeysValue as any, undefined, true);

    if (this.endpoint?.body?.deniedKeys) this.checkIfKeysExist(this.endpoint.body.deniedKeys, undefined, true);

    if (this.endpoint?.body?.deniedKeysValue)
      this.checkIfKeysValueExist(this.endpoint.body.deniedKeysValue as any, undefined, true);

    if (this.endpoint?.query?.schemas && !isEmpty(this.filter)) {
      // this validate filter against the defined schema
      const validate = ajv.compile(this.endpoint.query.schemas);
      const valid = validate(this.filter);
      if (!valid)
        throw new StatusError(
          403,
          this.endpoint.query.errorTitle || "Restricted Query",
          this.endpoint.query.errorMessage || "The query you provided is not allowed by the system."
        );
    }

    if (this.endpoint?.body?.schemas && !isEmpty(this.update)) {
      // this validate filter against the defined schema
      const validate = ajv.compile(this.endpoint?.body.schemas);
      const valid = validate(this.update);
      if (!valid)
        throw new StatusError(
          403,
          this.endpoint.query?.errorTitle || "Restricted Body",
          this.endpoint.query?.errorMessage || "The body you provided is not allowed by the system.",
          validate.errors
        );
    }
  }

  checkIfKeysExist(keys: string[], prefixAction?: string | undefined, shouldDelete: boolean = false): Chain {
    return this._checkIfKeysExist(this.update, keys, prefixAction, shouldDelete);
  }
  checkIfKeysValueExist(record: KeyValue, prefixAction?: string | undefined, shouldDelete: boolean = false): Chain {
    return this._checkIfKeysValueExist(this.update, record, prefixAction, shouldDelete);
  }
}
