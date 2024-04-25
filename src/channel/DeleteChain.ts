import { KeyValue } from "@libs/security/action";
import { IP, UserDocument } from "@models/user.model";
import { FilterQuery, QueryOptions } from "mongoose";
import { BaseChain, Chain, ChainResult } from "./chain";
import NodeCache from "node-cache";
import { logger } from "@libs/logger";
import { makeQuery } from "@libs/utility";
import { validateDataSchema } from "./DataValidationSchema";
import { StatusError } from "@libs/errors/StatusError";
import { set } from "lodash-es";

export type DeleteChainResult<I> = ChainResult<I> & {
  filter: FilterQuery<I>;
  options: QueryOptions<I>;
};

export default class DeleteChain<I> extends BaseChain {
  constructor(
    iModel: Function,
    private filter: FilterQuery<I>,
    user: UserDocument,
    path: string,
    baseAction?: string,
    cache?: NodeCache,
    ip?: IP
  ) {
    super(iModel, user, path, "Delete", baseAction, cache, ip);
  }

  checkIfKeysExist(deniedKeys?: string[], prefixAction?: string | undefined): Chain {
    return this._checkIfKeysExist(this.filter, deniedKeys, prefixAction);
  }
  checkIfKeysValueExist(record: KeyValue, prefixAction?: string | undefined): Chain {
    return this._checkIfKeysValueExist(this.filter, record, prefixAction);
  }

  protected async prePerform(): Promise<void> {
    await super.prePerform();

    if (this.endpoint?.query?.deniedKeys) this.checkIfKeysExist(this.endpoint.query.deniedKeys);

    if (this.endpoint?.query?.deniedKeysValue) this.checkIfKeysValueExist(this.endpoint.query.deniedKeysValue);

    if (this.endpoint?.query?.schemas) {
      // this validate filter against the defined schema
      const { defaultValue, errors, isValid } = validateDataSchema(
        this.filter,
        this.endpoint?.query?.schemas,
        this.endpoint?.query?.default
      );

      if (!isValid)
        throw new StatusError(403, "Restricted Query", "The query you provided is not allowed by the system.", errors);
      set(this.endpoint?.query, "default", defaultValue);
    }
  }

  async perform<T = DeleteChainResult<I>>(options?: QueryOptions): Promise<T> {
    await this.prePerform();
    const filter = makeQuery(
      this.filter,
      this.endpoint?.query?.default,
      this.endpoint?.query?.merge,
      this.endpoint?.query?.isPrior
    );
    logger.info("Running Delete Operation", this.filter);
    return { filter: filter, options } as T;
  }
}
