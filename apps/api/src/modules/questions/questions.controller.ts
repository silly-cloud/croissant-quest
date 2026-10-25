import { createHash } from "node:crypto";
import { Controller, Get, Headers, Res } from "@nestjs/common";
import type { Response } from "express";
import { BANK, PRON_DICT, RULES, TAG, TAGNAME, TOPICS } from "@cq/content";

const payload = { questions: BANK, tags: TAG, tagNames: TAGNAME, topics: TOPICS, rules: RULES, pron: PRON_DICT };
const body = JSON.stringify(payload);
export const QUESTIONS_ETAG = `"${createHash("sha256").update(body).digest("base64url").slice(0, 27)}"`;

const matches = (header: string | undefined) =>
  !!header && header.split(",").some((t) => t.trim().replace(/^W\//, "") === QUESTIONS_ETAG || t.trim() === "*");

@Controller("questions")
export class QuestionsController {
  /** The bank is static per deploy, so one strong ETag; clients revalidate cheaply. */
  @Get()
  get(@Headers("if-none-match") inm: string | undefined, @Res() res: Response): void {
    res.setHeader("ETag", QUESTIONS_ETAG);
    res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
    if (matches(inm)) {
      res.status(304).end();
      return;
    }
    res.status(200).type("application/json").send(body);
  }
}
