import { db, listListNames } from "@sendex/db";
import Link from "next/link";
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
      <nav className="text-sm text-neutral-500">
        <Link href="/lists" className="hover:underline">
          Lists
        </Link>{" "}
        / Upload
      </nav>
      <h1 className="mt-1 text-2xl font-semibold">Upload List</h1>
      <p className="mt-1 text-sm text-neutral-600">
        CSV or TXT up to 10 MB, or paste numbers. One list per country; numbers are checked against
        the list's country.
      </p>
      <div className="mt-6">
        <UploadForm lists={lists} />
      </div>
    </section>
  );
}
