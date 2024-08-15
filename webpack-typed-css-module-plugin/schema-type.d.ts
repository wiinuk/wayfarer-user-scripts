/* eslint-disable @typescript-eslint/ban-types */
import type {
    JSONSchema4,
    JSONSchema6,
    JSONSchema7,
    JSONSchema4TypeName,
    JSONSchema6TypeName,
    JSONSchema7TypeName,
} from "json-schema";

type notImplemented = "not implemented";

type valueOf<record> = record[keyof record];

type getOr<
    defaultResult,
    record,
    key extends string | number | symbol
> = key extends keyof record ? record[key] : defaultResult;

type getOrUndefined<record, key extends string | number | symbol> = getOr<
    undefined,
    record,
    key
>;

type nullishOr<defaultValue, value> = value extends undefined | null
    ? defaultValue
    : value;

export type NormalizeType<T> = {
    [K in keyof T]: T[K];
};

export type Schema = JSONSchema4 | JSONSchema6 | JSONSchema7;

export type SchemaType<TSchema extends Schema> = NormalizeType<
    parseWithTypeNames<TSchema, getOrUndefined<TSchema, "type">>
>;

type TypeName = JSONSchema4TypeName | JSONSchema6TypeName | JSONSchema7TypeName;
type TypeNames = TypeName | TypeName[];
type parseWithTypeNames<
    schema extends Schema,
    names extends TypeNames | undefined
> = names extends undefined
    ? unknown
    : names extends "string"
    ? string
    : names extends "number"
    ? number
    : names extends "integer"
    ? number
    : names extends "boolean"
    ? boolean
    : names extends "null"
    ? null
    : names extends "any"
    ? unknown
    : names extends "object"
    ? parseObject<schema>
    : // "array"
      // TypeName[]
      notImplemented;

type parseObject<schema extends Schema> = getOr<
    [],
    schema,
    "required"
> extends []
    ? parseProperties<nullishOr<{}, schema["properties"]>>
    : notImplemented;

type parseProperties<properties extends NonNullable<Schema["properties"]>> = {
    [k in keyof properties]?: parseSchemaDefinition<properties[k]>;
};

type SchemaDefinition = valueOf<NonNullable<Schema["properties"]>>;
type parseSchemaDefinition<definition extends SchemaDefinition> =
    definition extends infer schema extends Schema
        ? SchemaType<schema>
        : notImplemented;
