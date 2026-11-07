import { db, listListNames } from "@sendex/db";
import { PageHeader } from "@sendex/ui";
import { AuthError, requireAction } from "../../../../lib/auth";
import { AuthErrorView } from "../../require-org";
import { UploadForm } from "./upload-form";

export const dynamic = "force-dynamic";

/** Upload a list: file or paste, column mapping, settings, then chunked import. */
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
    <section className="max-w-5xl">
      <PageHeader
        breadcrumb={[{ label: "Contacts" }, { label: "Upload Contacts" }]}
        title="Upload Contacts"
        subtitle="CSV, TXT, XLS or XLSX up to 10 MB each, or paste numbers. One list per country; numbers are checked against the list's country."
      />
      <div className="mt-2">
        <UploadForm lists={lists} />
      </div>
    </section>
  );
}
