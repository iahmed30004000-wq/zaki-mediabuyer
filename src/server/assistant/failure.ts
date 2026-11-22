/** What an error of a model call is, as a status and a sentence for the owner (the assistant's two routes say it the same way). */
import { PrivacyRefusal } from "@/gateway/privacy";
import { HttpError } from "../auth";
import { AssistantError } from "./loop";

export function failure(e: unknown): { status: number; message: string; code?: string } {
  if (e instanceof PrivacyRefusal) {
    const what = e.hits.map((h) => ({ phone: "رقم هاتف", email: "إيميل", token: "مفتاح" })[h]).join(" و");
    return { status: 422, message: `رسالتك فيها ${what} — ما بدخل بيانات زبون ولا مفاتيح للموديل. شيله وجرّب كمان مرة.`, code: "privacy" };
  }
  if (e instanceof AssistantError) return { status: e.status, message: e.message, code: e.code };
  if (e instanceof HttpError) return { status: e.status, message: e.message };
  console.error("[assistant]", e);
  return { status: 500, message: "صار خطأ، جرّب كمان مرة." };
}
