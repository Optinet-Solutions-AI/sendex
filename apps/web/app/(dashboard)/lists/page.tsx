import { RequireOrg } from "../require-org";

export default function ListsPage() {
  return (
    <RequireOrg action="list.view">
      {() => (
        <section>
          <h1 className="text-2xl font-semibold">Lists</h1>
          <p className="mt-2 text-sm text-neutral-600">List upload arrives with card D1-16.</p>
        </section>
      )}
    </RequireOrg>
  );
}
