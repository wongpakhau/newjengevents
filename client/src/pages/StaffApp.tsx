import { useRoute, Redirect } from "wouter";
import { ScanLine, Users, ReceiptText, Gift, Gavel, Menu } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Guard, MustChangeBanner } from "@/lib/auth";
import { AppShell, Tab } from "@/components/ef/Shell";
import CheckInTab from "./staff/CheckIn";
import GuestsTab from "./staff/Guests";
import ReportTab from "./staff/Report";
import DrawsTab from "./staff/Draws";
import AuctionsTab from "./staff/Auctions";
import MoreTab from "./staff/More";

const ALL: Tab[] = [
  { key: "checkin", label: "簽到", icon: <ScanLine size={20} /> },
  { key: "guests", label: "嘉賓", icon: <Users size={20} /> },
  { key: "report", label: "對帳", icon: <ReceiptText size={20} /> },
  { key: "draws", label: "抽獎", icon: <Gift size={20} /> },
  { key: "auctions", label: "拍賣", icon: <Gavel size={20} /> },
  { key: "more", label: "更多", icon: <Menu size={20} /> },
];
const STAFF_ONLY = ["checkin", "more"];
const ROLE_TITLE: Record<string, string> = { owner: "系統擁有人", admin: "大會管理員", staff: "工作人員" };

export default function StaffApp() {
  const [, p] = useRoute("/staff/:tab");
  const me = trpc.auth.me.useQuery();
  const tab = p?.tab;
  const isAdmin = me.data?.role === "owner" || me.data?.role === "admin";
  if (!tab) return <Redirect to="/staff/checkin" />;
  const tabs = isAdmin ? ALL : ALL.filter((t) => STAFF_ONLY.includes(t.key));
  const allowed = tabs.some((t) => t.key === tab);
  return (
    <Guard roles={["owner", "admin", "staff"]}>
      {me.data && !allowed ? (
        <Redirect to="/staff/checkin" />
      ) : (
        <AppShell base="/staff" tabs={tabs} active={tab} title={ROLE_TITLE[me.data?.role ?? "staff"]}>
          <MustChangeBanner />
          {tab === "checkin" && <CheckInTab />}
          {isAdmin && tab === "guests" && <GuestsTab />}
          {isAdmin && tab === "report" && <ReportTab />}
          {isAdmin && tab === "draws" && <DrawsTab />}
          {isAdmin && tab === "auctions" && <AuctionsTab />}
          {tab === "more" && <MoreTab isAdmin={!!isAdmin} />}
        </AppShell>
      )}
    </Guard>
  );
}
