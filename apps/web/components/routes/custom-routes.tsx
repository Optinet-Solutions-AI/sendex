"use client";

import { countryName, countryOptions, flagEmoji } from "@sendex/core";
import {
  Badge,
  Button,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tooltip,
  UnderlineTabs,
  useToast,
} from "@sendex/ui";
import {
  BarChart3,
  DollarSign,
  Eye,
  EyeOff,
  Pencil,
  Plus,
  Radio,
  Send,
  Settings2,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useId, useState, useTransition } from "react";
import {
  createCustomRouteAction,
  deleteCustomRouteAction,
  setCustomRouteActiveAction,
  setCustomRoutePricesAction,
  updateCustomRouteAction,
} from "../../app/(dashboard)/routes/actions";
import { type CustomRouteTab, type RoutesQuery, routesQueryString } from "../../lib/routes-params";
import { ErrorText, inputClass } from "../campaigns/ui";
import { eur, int } from "../dashboard/format";

export interface CustomRouteView {
  id: string;
  name: string;
  kind: "HTTP" | "SMPP";
  host: string;
  active: boolean;
  config: Record<string, unknown>;
  prices: Array<{ country: string; priceMicro: number }>;
  createdAt: string;
}

const TABS: ReadonlyArray<{ value: CustomRouteTab; label: string; icon: React.ReactNode }> = [
  { value: "routes", label: "Routes", icon: <Radio /> },
  { value: "routing", label: "Routing Configuration", icon: <Settings2 /> },
  { value: "stats", label: "Stats", icon: <BarChart3 /> },
];

/** The Custom Routes header, tabs and the Routes tab table; the other tabs are passed in. */
export function CustomRoutes({
  query,
  routes,
  canManage,
  feeMicro,
  panels,
}: {
  query: RoutesQuery;
  routes: CustomRouteView[];
  canManage: boolean;
  feeMicro: number;
  panels: Record<Exclude<CustomRouteTab, "routes">, React.ReactNode>;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [editing, setEditing] = useState<CustomRouteView | "new" | null>(null);
  const [pricing, setPricing] = useState<CustomRouteView | null>(null);
  const [deleting, setDeleting] = useState<CustomRouteView | null>(null);
  const [, start] = useTransition();
  const go = (tab: CustomRouteTab) =>
    router.push(`/routes/custom${routesQueryString({ ...query, tab })}`);
  const active = routes.filter((r) => r.active).length;

  const toggleActive = (route: CustomRouteView) =>
    start(async () => {
      const result = await setCustomRouteActiveAction({ routeId: route.id, active: !route.active });
      if (!result.ok) toast({ title: result.error, variant: "error" });
      else router.refresh();
    });

  return (
    <div className="space-y-4" data-testid="custom-routes">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="text-sm text-muted">
          Connect any SMS route to the platform and send through it alongside our built-in routes.
          Custom routes are billed at{" "}
          <span className="font-semibold text-ink">{eur(feeMicro)} per SMS sent</span>.
          <div className="mt-1 flex items-center gap-3 text-xs">
            <span data-testid="custom-route-count">
              {int(routes.length)} {routes.length === 1 ? "route" : "routes"}
            </span>
            <span className="text-good">{int(active)} active</span>
          </div>
        </div>
        {canManage ? (
          <Button onClick={() => setEditing("new")} data-testid="add-route">
            <Plus className="h-4 w-4" aria-hidden="true" /> Add Route
          </Button>
        ) : null}
      </div>
      <UnderlineTabs label="Custom routes sections" value={query.tab} tabs={TABS} onChange={go} />
      {query.tab === "routes" ? (
        <Table data-testid="custom-routes-table">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-10" />
              <TableHead>Route</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Countries</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {routes.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-muted">
                  No custom routes yet. Add one to send through your own SMPP or HTTP carrier.
                </TableCell>
              </TableRow>
            ) : (
              routes.map((r) => (
                <TableRow key={r.id} data-testid="custom-route-row" data-active={r.active}>
                  <TableCell>
                    <IconButton
                      label={r.active ? `Switch ${r.name} off` : `Switch ${r.name} on`}
                      tooltip={r.active ? "On" : "Off"}
                      icon={r.active ? <Eye className="text-good" /> : <EyeOff />}
                      disabled={!canManage}
                      onClick={() => toggleActive(r)}
                      data-testid="route-eye"
                    />
                  </TableCell>
                  <TableCell>
                    <div className="font-semibold text-ink">{r.name}</div>
                    <div className="font-mono text-xs text-muted">{r.host}</div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="code">{r.kind}</Badge>
                  </TableCell>
                  <TableCell>
                    {r.prices.length === 0 ? (
                      <Badge variant="amber">No pricing</Badge>
                    ) : (
                      <span className="text-sm">
                        {r.prices.slice(0, 4).map((p) => (
                          <span key={p.country} className="mr-1" title={countryName(p.country)}>
                            {flagEmoji(p.country)}
                          </span>
                        ))}
                        {r.prices.length > 4 ? (
                          <span className="text-muted">+{r.prices.length - 4}</span>
                        ) : null}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    {r.active ? (
                      <Badge variant="active">Active</Badge>
                    ) : (
                      <Badge variant="secondary">Off</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <IconButton
                        label={`Edit ${r.name}`}
                        tooltip="Edit"
                        icon={<Pencil />}
                        disabled={!canManage}
                        onClick={() => setEditing(r)}
                        data-testid="route-edit"
                      />
                      <IconButton
                        label={`Pricing of ${r.name}`}
                        tooltip="Pricing"
                        icon={<DollarSign />}
                        disabled={!canManage}
                        onClick={() => setPricing(r)}
                        data-testid="route-pricing"
                      />
                      <Tooltip content="Test Connection needs the worker's custom-route adapter, which is not deployed yet">
                        <span className="inline-flex">
                          <IconButton
                            label={`Test connection of ${r.name}`}
                            noTooltip
                            icon={<Send />}
                            disabled
                          />
                        </span>
                      </Tooltip>
                      <IconButton
                        label={`Delete ${r.name}`}
                        tooltip="Delete"
                        icon={<Trash2 />}
                        tone="danger"
                        disabled={!canManage}
                        onClick={() => setDeleting(r)}
                        data-testid="route-delete"
                      />
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      ) : (
        <div key={query.tab}>{panels[query.tab]}</div>
      )}

      <RouteDialog
        route={editing === "new" ? null : editing}
        open={editing !== null}
        onClose={() => setEditing(null)}
      />
      {pricing ? <PricingDialog route={pricing} open onClose={() => setPricing(null)} /> : null}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => {
          if (!o) setDeleting(null);
        }}
        title={`Delete ${deleting?.name ?? "route"}?`}
        description="Its prices and connection history go with it. Campaigns that used it keep their sent messages."
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (!deleting) return;
          const result = await deleteCustomRouteAction({ routeId: deleting.id });
          if (!result.ok) throw new Error(result.error);
          toast({ title: "Route deleted", variant: "success" });
          setDeleting(null);
          router.refresh();
        }}
      />
    </div>
  );
}

type HeaderRow = { name: string; value: string };

/** Add Custom Route / Edit: HTTP API or SMPP, with the placeholders hint and custom headers. */
function RouteDialog({
  route,
  open,
  onClose,
}: {
  route: CustomRouteView | null;
  open: boolean;
  onClose: () => void;
}) {
  const id = useId();
  const router = useRouter();
  const { toast } = useToast();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const cfg = route?.config ?? {};
  const [type, setType] = useState<"http" | "smpp">(route?.kind === "SMPP" ? "smpp" : "http");
  const [name, setName] = useState(route?.name ?? "");
  const [apiUrl, setApiUrl] = useState(String(cfg.apiUrl ?? ""));
  const [username, setUsername] = useState(String(cfg.username ?? ""));
  const [password, setPassword] = useState("");
  const [usePost, setUsePost] = useState(cfg.usePost === undefined ? true : Boolean(cfg.usePost));
  const [headers, setHeaders] = useState<HeaderRow[]>(
    Array.isArray(cfg.headers) ? (cfg.headers as HeaderRow[]) : [],
  );
  const [host, setHost] = useState(String(cfg.host ?? ""));
  const [port, setPort] = useState(String(cfg.port ?? "2775"));
  const [systemId, setSystemId] = useState(String(cfg.systemId ?? ""));
  const [systemType, setSystemType] = useState(String(cfg.systemType ?? ""));
  const [tls, setTls] = useState(Boolean(cfg.tls));

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const payload =
      type === "http"
        ? { type, name, apiUrl, username, password, usePost, headers }
        : {
            type,
            name,
            host,
            port: Number.parseInt(port, 10),
            systemId,
            password,
            systemType,
            tls,
          };
    start(async () => {
      const result = route
        ? await updateCustomRouteAction({ routeId: route.id, ...payload })
        : await createCustomRouteAction(payload);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast({ title: route ? "Route updated" : "Route created", variant: "success" });
      onClose();
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent className="max-w-lg" data-testid="route-dialog">
        <DialogTitle className="text-lg font-semibold">
          {route ? "Edit Custom Route" : "Add Custom Route"}
        </DialogTitle>
        <DialogDescription className="mt-1 text-sm text-muted">
          Connect your own SMS route via SMPP or HTTP API.
        </DialogDescription>
        <form onSubmit={submit} className="mt-4 space-y-3">
          <label className="block text-sm">
            <span className="text-muted">Name</span>
            <input
              className={inputClass}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Route"
              data-testid="route-name"
            />
          </label>
          <label className="block text-sm">
            <span className="text-muted">Connection Type</span>
            <select
              className={inputClass}
              value={type}
              onChange={(e) => setType(e.target.value === "smpp" ? "smpp" : "http")}
              data-testid="route-type"
            >
              <option value="http">HTTP API</option>
              <option value="smpp">SMPP</option>
            </select>
          </label>
          {type === "http" ? (
            <>
              <label className="block text-sm">
                <span className="text-muted">API URL</span>
                <input
                  className={inputClass}
                  value={apiUrl}
                  onChange={(e) => setApiUrl(e.target.value)}
                  placeholder="https://api.provider.com/sms?from={{{from}}}&to={{{number}}}&text={{{text}}}"
                  data-testid="route-api-url"
                />
                <span className="text-xs text-muted">
                  Use {"{{{from}}}"}, {"{{{number}}}"}, {"{{{text}}}"} as placeholders
                </span>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-sm">
                  <span className="text-muted">Username</span>
                  <input
                    className={inputClass}
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    autoComplete="off"
                  />
                </label>
                <label className="block text-sm">
                  <span className="text-muted">Password</span>
                  <input
                    className={inputClass}
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={route ? "•••••• (unchanged)" : ""}
                    autoComplete="new-password"
                  />
                </label>
              </div>
              <label className="inline-flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={usePost}
                  onChange={(e) => setUsePost(e.target.checked)}
                />{" "}
                Use POST method
              </label>
              <fieldset className="space-y-2">
                <div className="flex items-center justify-between">
                  <legend className="text-sm text-muted">Custom Headers</legend>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setHeaders((h) => [...h, { name: "", value: "" }])}
                    data-testid="add-header"
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add Header
                  </Button>
                </div>
                {headers.length === 0 ? (
                  <p className="text-xs text-muted">
                    No custom headers. Click "Add Header" to add one.
                  </p>
                ) : (
                  headers.map((h, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional until saved
                    <div key={i} className="flex items-center gap-2" data-testid="header-row">
                      <input
                        className={inputClass}
                        placeholder="Header name"
                        aria-label={`Header ${i + 1} name`}
                        value={h.name}
                        onChange={(e) =>
                          setHeaders((rows) =>
                            rows.map((r, j) => (j === i ? { ...r, name: e.target.value } : r)),
                          )
                        }
                      />
                      <input
                        className={inputClass}
                        placeholder="Value"
                        aria-label={`Header ${i + 1} value`}
                        value={h.value}
                        onChange={(e) =>
                          setHeaders((rows) =>
                            rows.map((r, j) => (j === i ? { ...r, value: e.target.value } : r)),
                          )
                        }
                      />
                      <IconButton
                        label={`Remove header ${i + 1}`}
                        icon={<Trash2 />}
                        tone="danger"
                        noTooltip
                        onClick={() => setHeaders((rows) => rows.filter((_, j) => j !== i))}
                      />
                    </div>
                  ))
                )}
              </fieldset>
            </>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-3">
                <label className="col-span-2 block text-sm">
                  <span className="text-muted">Host</span>
                  <input
                    className={inputClass}
                    value={host}
                    onChange={(e) => setHost(e.target.value)}
                    placeholder="smpp.provider.com"
                    data-testid="route-host"
                  />
                </label>
                <label className="block text-sm">
                  <span className="text-muted">Port</span>
                  <input
                    className={inputClass}
                    inputMode="numeric"
                    value={port}
                    onChange={(e) => setPort(e.target.value)}
                  />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-sm">
                  <span className="text-muted">System ID</span>
                  <input
                    className={inputClass}
                    value={systemId}
                    onChange={(e) => setSystemId(e.target.value)}
                    autoComplete="off"
                  />
                </label>
                <label className="block text-sm">
                  <span className="text-muted">Password</span>
                  <input
                    className={inputClass}
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={route ? "•••••• (unchanged)" : ""}
                    autoComplete="new-password"
                  />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-sm">
                  <span className="text-muted">System type (optional)</span>
                  <input
                    className={inputClass}
                    value={systemType}
                    onChange={(e) => setSystemType(e.target.value)}
                  />
                </label>
                <label className="inline-flex items-center gap-2 self-end text-sm">
                  <input type="checkbox" checked={tls} onChange={(e) => setTls(e.target.checked)} />{" "}
                  TLS
                </label>
              </div>
            </>
          )}
          <ErrorText error={error} />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending} data-testid="route-submit">
              {route ? "Save" : "Create"}
            </Button>
          </div>
        </form>
        <span className="sr-only" id={id} />
      </DialogContent>
    </Dialog>
  );
}

/** Pricing: one row per country with the price in EUR; a route covers a country once it has a price there. */
function PricingDialog({
  route,
  open,
  onClose,
}: {
  route: CustomRouteView;
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [rows, setRows] = useState<Array<{ country: string; priceEur: string }>>(
    route.prices.map((p) => ({
      country: p.country,
      priceEur: (p.priceMicro / 1_000_000).toFixed(4),
    })),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const save = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    start(async () => {
      const result = await setCustomRoutePricesAction({ routeId: route.id, prices: rows });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast({ title: "Prices saved", variant: "success" });
      onClose();
      router.refresh();
    });
  };
  return (
    <Dialog open={open} onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent className="max-w-md" data-testid="pricing-dialog">
        <DialogTitle className="text-lg font-semibold">Pricing · {route.name}</DialogTitle>
        <DialogDescription className="mt-1 text-sm text-muted">
          Price per SMS part in EUR for each country the route covers. The platform fee is added on
          top.
        </DialogDescription>
        <form onSubmit={save} className="mt-4 space-y-2">
          {rows.map((r, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional until saved
            <div key={i} className="flex items-center gap-2" data-testid="price-row">
              <select
                className={inputClass}
                aria-label={`Country ${i + 1}`}
                value={r.country}
                onChange={(e) =>
                  setRows((rs) =>
                    rs.map((x, j) => (j === i ? { ...x, country: e.target.value } : x)),
                  )
                }
              >
                <option value="">Country…</option>
                {countryOptions.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </select>
              <input
                className={inputClass}
                aria-label={`Price ${i + 1} (EUR)`}
                inputMode="decimal"
                placeholder="0.0357"
                value={r.priceEur}
                onChange={(e) =>
                  setRows((rs) =>
                    rs.map((x, j) => (j === i ? { ...x, priceEur: e.target.value } : x)),
                  )
                }
              />
              <IconButton
                label={`Remove price ${i + 1}`}
                icon={<Trash2 />}
                tone="danger"
                noTooltip
                onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
              />
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setRows((rs) => [...rs, { country: "", priceEur: "" }])}
            data-testid="add-price"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add country
          </Button>
          <ErrorText error={error} />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending} data-testid="pricing-submit">
              Save
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
