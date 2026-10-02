import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Copy, Link2, Plus, RefreshCw, Send, UserMinus, Ban } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { fetchMyOrgs, type Org } from "@/lib/queries";
import {
  createDropLink,
  renewDropLink,
  revokeDropLink,
  addMember,
  removeMember,
  sendToClinicInit,
  sendToClinicComplete,
} from "@/lib/files.functions";
import { dropUrl, guessMime } from "@/lib/upload";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/clinics")({
  head: () => ({
    meta: [
      { title: "Gabinety — DentalHub" },
      { name: "description", content: "Zarządzaj gabinetami, linkami do wysyłania i dostępem." },
      { property: "og:title", content: "Gabinety — DentalHub" },
      { property: "og:description", content: "Zarządzaj gabinetami, linkami do wysyłania i dostępem." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ClinicsPage,
});

const roleLabel: Record<string, string> = { admin: "Administrator", doctor: "Lekarz", staff: "Recepcja" };

function ClinicsPage() {
  const qc = useQueryClient();
  const orgs = useQuery({ queryKey: ["orgs"], queryFn: fetchMyOrgs });
  const [sel, setSel] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const current = orgs.data?.find((o) => o.id === sel) ?? orgs.data?.[0];

  async function create() {
    const name = newName.trim();
    if (!name || name.length > 120) return toast.error("Podaj nazwę gabinetu.");
    const { error } = await supabase.rpc("create_organization", { _name: name, _kind: "clinic" });
    if (error) return toast.error("Nie udało się utworzyć gabinetu.");
    setNewName("");
    qc.invalidateQueries({ queryKey: ["orgs"] });
    toast.success("Gabinet utworzony");
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold">Gabinety</h1>
      <div className="-mx-4 mt-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {orgs.data?.map((o) => (
          <button
            key={o.id}
            onClick={() => setSel(o.id)}
            className={`h-10 shrink-0 rounded-full border px-4 text-sm font-medium ${current?.id === o.id ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted"}`}
          >
            {o.name}
          </button>
        ))}
      </div>
      <div className="mt-3 flex gap-2">
        <Input placeholder="Nazwa nowego gabinetu" value={newName} maxLength={120} onChange={(e) => setNewName(e.target.value)} />
        <Button onClick={create}>
          <Plus /> Dodaj
        </Button>
      </div>

      {current && <OrgPanel key={current.id} org={current} />}
    </div>
  );
}

function OrgPanel({ org }: { org: Org }) {
  const isAdmin = org.role === "admin";
  return (
    <div className="mt-6 rounded-2xl border bg-card p-5 shadow-soft">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold">{org.name}</h2>
        <Badge variant="secondary">{roleLabel[org.role]}</Badge>
      </div>
      <Tabs defaultValue="links" className="mt-4">
        <TabsList>
          <TabsTrigger value="links">Linki</TabsTrigger>
          <TabsTrigger value="send">Wyślij</TabsTrigger>
          {isAdmin && <TabsTrigger value="members">Członkowie</TabsTrigger>}
          {isAdmin && <TabsTrigger value="audit">Audyt</TabsTrigger>}
        </TabsList>
        <TabsContent value="links"><LinksTab org={org} /></TabsContent>
        <TabsContent value="send"><SendTab org={org} /></TabsContent>
        {isAdmin && <TabsContent value="members"><MembersTab org={org} /></TabsContent>}
        {isAdmin && <TabsContent value="audit"><AuditTab org={org} /></TabsContent>}
      </Tabs>
    </div>
  );
}

function LinksTab({ org }: { org: Org }) {
  const qc = useQueryClient();
  const create = useServerFn(createDropLink);
  const renew = useServerFn(renewDropLink);
  const revoke = useServerFn(revokeDropLink);
  const [label, setLabel] = useState("Recepcja");
  const [forMe, setForMe] = useState("me");
  const [fresh, setFresh] = useState<string | null>(null);
  const links = useQuery({
    queryKey: ["links", org.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("drop_links")
        .select("*")
        .eq("org_id", org.id)
        .is("revoked_at", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  async function run(fn: () => Promise<{ token?: string } | unknown>) {
    try {
      const r = (await fn()) as { token?: string };
      if (r?.token) setFresh(dropUrl(r.token));
      qc.invalidateQueries({ queryKey: ["links", org.id] });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="space-y-4 pt-2">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} placeholder="Etykieta, np. Recepcja, Laboratorium" />
        <Select value={forMe} onValueChange={setForMe}>
          <SelectTrigger className="sm:w-56"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="me">Pliki dla mnie</SelectItem>
            {org.role === "admin" && <SelectItem value="clinic">Do skrzynki gabinetu</SelectItem>}
          </SelectContent>
        </Select>
        <Button onClick={() => run(() => create({ data: { orgId: org.id, forMe: forMe === "me", label: label.trim() || "Link" } }))}>
          <Link2 /> Utwórz link
        </Button>
      </div>
      <ul className="divide-y rounded-xl border">
        {links.data?.length === 0 && <li className="p-4 text-sm text-muted-foreground">Brak aktywnych linków.</li>}
        {links.data?.map((l) => (
          <li key={l.id} className="flex flex-wrap items-center gap-2 p-3">
            <div className="min-w-0 flex-1">
              <p className="font-medium">{l.label}</p>
              <p className="text-xs text-muted-foreground">
                {l.recipient_user_id ? "Dla lekarza" : "Skrzynka gabinetu"} · wysłano {l.uses} ·{" "}
                {l.expires_at ? `wygasa ${new Date(l.expires_at).toLocaleDateString("pl-PL")}` : "bez terminu"}
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={() => run(() => renew({ data: { id: l.id } }))}>
              <RefreshCw /> Odnów
            </Button>
            <Button size="sm" variant="ghost" onClick={() => run(() => revoke({ data: { id: l.id } }))}>
              <Ban /> Wyłącz
            </Button>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        Link jest pokazywany tylko raz (przechowujemy jedynie jego skrót). Zgubiony link — kliknij „Odnów”.
      </p>
      <Dialog open={!!fresh} onOpenChange={(v) => !v && setFresh(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Link do wysyłania gotowy</DialogTitle>
            <DialogDescription>Skopiuj go teraz i przekaż recepcji. Nie pokażemy go ponownie.</DialogDescription>
          </DialogHeader>
          <div className="break-all rounded-lg bg-muted p-3 font-mono text-xs">{fresh}</div>
          <div className="flex gap-2">
            <Button className="flex-1" onClick={() => { navigator.clipboard.writeText(fresh!); toast.success("Skopiowano"); }}>
              <Copy /> Kopiuj
            </Button>
            <Button variant="outline" asChild>
              <a href={fresh ?? "#"} target="_blank" rel="noreferrer">Otwórz</a>
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SendTab({ org }: { org: Org }) {
  const init = useServerFn(sendToClinicInit);
  const complete = useServerFn(sendToClinicComplete);
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function send() {
    if (!file) return;
    setBusy(true);
    try {
      const meta = { orgId: org.id, fileName: file.name, size: file.size, mime: guessMime(file) };
      const r = await init({ data: meta });
      const { error } = await supabase.storage.from("files").uploadToSignedUrl(r.path, r.uploadToken, file, { contentType: meta.mime });
      if (error) throw new Error("Wysyłanie przerwane.");
      await complete({ data: { ...meta, path: r.path, note } });
      toast.success(`Wysłano do skrzynki: ${org.name}`);
      setFile(null);
      setNote("");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 pt-2">
      <p className="text-sm text-muted-foreground">Wyślij plik do skrzynki gabinetu (widzą go administrator i recepcja).</p>
      <Input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      <Input placeholder="Notatka (opcjonalnie)" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
      <Button disabled={!file || busy} onClick={send}>
        <Send /> Wyślij do gabinetu
      </Button>
    </div>
  );
}

function MembersTab({ org }: { org: Org }) {
  const qc = useQueryClient();
  const add = useServerFn(addMember);
  const remove = useServerFn(removeMember);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"doctor" | "staff" | "admin">("doctor");
  const members = useQuery({
    queryKey: ["members", org.id],
    queryFn: async () => {
      const { data: ms, error } = await supabase.from("memberships").select("id, user_id, role").eq("org_id", org.id);
      if (error) throw error;
      const { data: ps } = await supabase.from("profiles").select("id, display_name, email").in("id", ms.map((m) => m.user_id));
      return ms.map((m) => ({ ...m, profile: ps?.find((p) => p.id === m.user_id) }));
    },
  });

  async function invite() {
    try {
      const r = await add({ data: { orgId: org.id, email, role } });
      toast.success(r.status === "added" ? "Dodano do gabinetu" : "Wysłano zaproszenie (demo — e-mail nie wychodzi)");
      setEmail("");
      qc.invalidateQueries({ queryKey: ["members", org.id] });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function revokeAccess(id: string) {
    if (!confirm("Odebrać dostęp? Działa natychmiast, a linki tej osoby zostaną wyłączone.")) return;
    try {
      await remove({ data: { membershipId: id } });
      toast.success("Dostęp odebrany");
      qc.invalidateQueries({ queryKey: ["members", org.id] });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="space-y-4 pt-2">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input type="email" placeholder="e-mail osoby" value={email} onChange={(e) => setEmail(e.target.value)} />
        <Select value={role} onValueChange={(v) => setRole(v as typeof role)}>
          <SelectTrigger className="sm:w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="doctor">Lekarz</SelectItem>
            <SelectItem value="staff">Recepcja</SelectItem>
            <SelectItem value="admin">Administrator</SelectItem>
          </SelectContent>
        </Select>
        <Button onClick={invite}><Plus /> Zaproś</Button>
      </div>
      <ul className="divide-y rounded-xl border">
        {members.data?.map((m) => (
          <li key={m.id} className="flex items-center gap-3 p-3">
            <div className="min-w-0 flex-1">
              <p className="font-medium">{m.profile?.display_name ?? "—"}</p>
              <p className="truncate text-xs text-muted-foreground">{m.profile?.email} · {roleLabel[m.role]}</p>
            </div>
            {m.id !== org.membershipId && (
              <Button size="sm" variant="outline" onClick={() => revokeAccess(m.id)}>
                <UserMinus /> Odbierz dostęp
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

const actionLabel: Record<string, string> = {
  "org.create": "Utworzono gabinet",
  "item.drop": "Wrzucono plik przez link",
  "item.open": "Otwarto plik",
  "item.delete": "Usunięto plik",
  "item.send_to_clinic": "Wysłano plik do gabinetu",
  "link.create": "Utworzono link",
  "link.renew": "Odnowiono link",
  "link.revoke": "Wyłączono link",
  "member.add": "Dodano członka",
  "member.revoke": "Odebrano dostęp",
};

function AuditTab({ org }: { org: Org }) {
  const log = useQuery({
    queryKey: ["audit", org.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("audit_log")
        .select("*")
        .eq("org_id", org.id)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data;
    },
  });
  return (
    <ul className="mt-2 divide-y rounded-xl border text-sm">
      {log.data?.length === 0 && <li className="p-4 text-muted-foreground">Brak wpisów.</li>}
      {log.data?.map((a) => (
        <li key={a.id} className="flex justify-between gap-3 p-3">
          <span>
            {actionLabel[a.action] ?? a.action}
            {a.actor_label && <span className="text-muted-foreground"> · {a.actor_label}</span>}
          </span>
          <span className="shrink-0 text-xs text-muted-foreground">{new Date(a.created_at).toLocaleString("pl-PL")}</span>
        </li>
      ))}
    </ul>
  );
}
