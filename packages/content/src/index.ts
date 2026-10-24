import { z } from "zod";
import bankJson from "../data/bank.json" with { type: "json" };
import pronJson from "../data/pron.json" with { type: "json" };
import tagsJson from "../data/tags.json" with { type: "json" };
import topicsJson from "../data/topics.json" with { type: "json" };
import rulesJson from "../data/rules.json" with { type: "json" };
import { Question, Topic } from "./schema.js";

export * from "./schema.js";

export const BANK: Question[] = z.array(Question).parse(bankJson);
export const TOPICS: Topic[] = z.array(Topic).parse(topicsJson);
/** word → [english, gujarati, devanagari] */
export const PRON_DICT: Record<string, [string, string, string]> = pronJson as never;
/** rule text per tag: [rule html, trick] */
export const TAG: Record<string, [string, string]> = tagsJson.TAG as never;
export const TAGNAME: Record<string, string> = tagsJson.TAGNAME;
/** topic id → rule card html */
export const RULES: Record<string, string> = rulesJson;
