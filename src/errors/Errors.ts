export class BodyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BodyError";
  }
}
export class QueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BodyError";
  }
}
