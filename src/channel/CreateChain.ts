import ajv from "@libs/ajv/ajv";
import { StatusError } from "@libs/errors/StatusError";
import { logger } from "@libs/logger";
import { moveFieldsFile } from "@libs/s3/s3.util";
import { KeyValue, Uploads } from "@models/user-level.model";
import { IP, UserDocument } from "@models/user.model";
import { isEmpty, merge, set, uniqBy } from "lodash-es";
import { CreateOptions, UpdateQuery } from "mongoose";
import NodeCache from "node-cache";
import { getEntity } from "room/decorators/decorator.util";
import { validateDataSchema } from "./DataValidationSchema";
import { BaseChain, Chain } from "./chain";

export type CreateChainResult<I> = {
  doc: I;
  filter?: UpdateQuery<I>;
  options: CreateOptions;
};

export default class CreateChain<I> extends BaseChain {
  constructor(
    iModel: Function,
    private doc: I,
    user: UserDocument,
    path: string,
    baseAction?: string,
    cache?: NodeCache,
    ip?: IP
  ) {
    super(iModel, user, path, "Create", baseAction, cache, ip);
  }

  checkIfKeysExist(keys: string[], prefixAction?: string, shouldDelete: boolean = false): Chain {
    return this._checkIfKeysExist(this.doc as Record<string, any>, keys, prefixAction, shouldDelete);
  }
  checkIfKeysValueExist(record: KeyValue, prefixAction?: string, shouldDelete: boolean = false): Chain {
    return this._checkIfKeysValueExist(this.doc as Record<string, any>, record, prefixAction, shouldDelete);
  }

  protected async prePerform() {
    await super.prePerform();

    if (this.endpoint?.body?.deniedKeys) this.checkIfKeysExist(this.endpoint.body.deniedKeys, undefined, true);

    if (this.endpoint?.body?.deniedKeysValue) this.checkIfKeysValueExist(this.endpoint.body.deniedKeysValue, undefined, true);

    if (this.endpoint?.body?.schemas) {
      // this validate filter against the defined schema

      const { isValid, defaultValue, errors } = validateDataSchema(
        this.doc,
        this.endpoint?.body.schemas,
        this.endpoint.body.default
      );
      if (!isValid)
        throw new StatusError(
          403,
          "Restricted Data",
          "The data you provided violates some of our policies. Check it or consulate support.",
          errors
        );
      set(this.endpoint.body, "default", defaultValue);
    } else if ([undefined, true].includes(this.endpoint?.body?.useDefaultSchema)) {
      const validate = ajv.compile(getEntity(this.iModel, "docs:model"));
      const valid = validate(this.doc);
      if (!valid)
        throw new StatusError(
          403,
          "Restricted Data",
          "The data you provided violates some of our policies. Check it or consulate support.",
          validate.errors
        );
    }
  }

  async perform<T = CreateChainResult<I>>(options?: CreateOptions): Promise<T> {
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

    let doc = this.setCurrentUser(merge({}, this.doc, this.endpoint?.body?.default || {}), uploadFile);

    let files = {};

    let uploads = this.endpoint?.body?.uploads || [];

    uploads = uploads.map((u) => ({ ...u, directory: u.directory.replaceAll("*current_user*", this.user?._id!.toString()) }));

    tempUploads.unshift(...uploads);
    tempUploads = uniqBy(tempUploads, "field");

    if (!isEmpty(tempUploads)) {
      files = await moveFieldsFile(tempUploads, doc);
    }

    doc = merge({}, doc, files);
    logger.info("Running Create operation", doc);
    return { doc, options, filter: this.endpoint?.query?.default } as T;
  }
}
