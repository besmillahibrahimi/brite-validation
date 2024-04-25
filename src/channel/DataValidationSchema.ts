import ajv from "@libs/ajv/ajv";
import { AnySchemaObject, ErrorObject } from "ajv";
import { cloneDeep, isArray } from "lodash-es";

interface ValidationResult<T> {
  errors?: ErrorObject[] | null;
  defaultValue?: T;
  defaultOption?: any;
  isValid?: boolean;
}

function getDefault(obj: any, index: number) {
  return isArray(obj) ? obj[index] : obj;
}

function excludeFields(schema: any) {
  const s = cloneDeep(schema);
  delete s.sort;
  delete s.locale;

  return s;
}

export function validateDataSchema<T>(data: T, schema: AnySchemaObject, defaultData?: T, defaultOpt?: any): ValidationResult<T> {
  let errors;
  let defaultValue = defaultData;
  let defaultOption = defaultOpt;
  let isValid: boolean;

  if (schema.anyOf) {
    const index = schema.anyOf.findIndex((subSchema) => {
      const validate = ajv.compile(subSchema);
      const res = validate(excludeFields(data));

      if (!res) errors = validate.errors;

      return res;
    });
    if (index > -1) {
      isValid = true;
      defaultValue = schema.anyOf[index].default ? schema.anyOf[index].default : getDefault(defaultData, index);
      defaultOption = schema.anyOf[index].options ? schema.anyOf[index].options : getDefault(defaultOpt, index);
    } else {
      isValid = false;
    }
  } else {
    const validate = ajv.compile(schema);
    const res = validate(excludeFields(data));
    if (!res) {
      isValid = false;
      errors = validate.errors;
    } else {
      isValid = true;
      defaultValue = schema.default ?? defaultData;
      defaultOption = schema.options ?? defaultOpt;
    }
  }

  return {
    errors,
    defaultValue,
    defaultOption,
    isValid,
  };
}
