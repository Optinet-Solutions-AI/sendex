import { db, listListNames } from "@sendex/db";
import { AuthError, requireAction } from "../../../../lib/auth";
import { AuthErrorView } from "../../require-org";
import { UploadForm } from "./upload-form";

export const dynamic = "force-dynamic";

/** Upload Contacts: files or paste, then the Import step (settings, field types), chunked import. */
export default async function UploadListPage() {
  let organisationId: string;
  try {
    organisationId = (await requireAction("list.upload")).organisationId;
  } catch (error) {
    if (error instanceof AuthError) return <AuthErrorView error={error} />;
    throw error;
  }
  const lists = await listListNames(db(), organisationId);
  return (
    <section className="max-w-6xl">
      <UploadForm lists={lists} />
    </section>
  );
}
