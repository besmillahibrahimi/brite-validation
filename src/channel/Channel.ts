import { LaunchingMaxContext } from "@libs/app/LaunchingMax";
import { StatusError } from "@libs/errors/StatusError";
import { IP, UserDocument } from "@models/user.model";
import { isEmpty } from "lodash-es";
import { FilterQuery, UpdateQuery } from "mongoose";
import NodeCache from "node-cache";
import { FindFilter } from "room/query/types";
import CreateChain from "./CreateChain";
import DeleteChain from "./DeleteChain";
import ReadChain from "./ReadChain";
import UpdateChain from "./UpdateChain";
import { Chain } from "./chain";

class ChannelMethod<I> {
  constructor(
    private iModel: Function,
    private user: UserDocument,
    private path: string,
    private baseAction?: string,
    private cache?: NodeCache,
    private ip?: IP
  ) {}

  Create(doc: I): Chain {
    return new CreateChain(this.iModel, doc, this.user, this.path, this.baseAction, this.cache, this.ip);
  }

  Read(filter: FindFilter<I>): Chain {
    return new ReadChain(this.iModel, filter, this.user, this.path, this.baseAction, this.cache, this.ip);
  }

  Update(filter: FilterQuery<I>, update: UpdateQuery<I>): Chain {
    return new UpdateChain<I>(this.iModel, filter, update, this.user, this.path, this.baseAction, this.cache, this.ip);
  }

  Delete(filter: FilterQuery<I>): Chain {
    return new DeleteChain(this.iModel, filter, this.user, this.path, this.baseAction, this.cache, this.ip);
  }
}

export default class Channel<I> {
  start(iModel: Function, user: UserDocument, path: string, baseAction?: string, cache?: NodeCache, ip?: IP) {
    return new ChannelMethod<I>(iModel, user, path, baseAction, cache, ip);
  }

  static createChain<I>(ctx: LaunchingMaxContext<I>, iModel: Function, baseAction?: string): Chain {
    const {
      body,
      query,
      params,
      ip,
      endpointKey,
      user,
      request: { method },
      store: { cache },
      baseAction: ba,
    } = ctx;
    switch (method) {
      case "POST":
        return new CreateChain(iModel, body, user!, endpointKey, baseAction || ba, cache, ip);
      case "PUT":
        return new UpdateChain(iModel, isEmpty(params) ? query : params, body!, user!, endpointKey, baseAction, cache, ip);
      case "DELETE":
        return new DeleteChain(iModel, isEmpty(params) ? query : params, user!, endpointKey, baseAction, cache, ip);
      case "GET":
        return new ReadChain(iModel, isEmpty(params) ? query : params, user!, endpointKey, baseAction, cache, ip);
      default:
        throw new StatusError(500, "Unknown Method", `There is a no Chain to create for method ${method}`);
    }
  }

  static async performChain<I>(ctx: LaunchingMaxContext<I>, iModel: Function) {
    const chain = Channel.createChain(ctx, iModel);
    return await chain.perform();
  }
}
