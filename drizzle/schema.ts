import {
  boolean,
  date,
  index,
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

/**
 * EventFlow 重建版資料表。
 * 所有業務表以 ef_ 開頭，避免與平台範本的 users 表混淆。
 */

export const efEvents = mysqlTable("ef_events", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 200 }).notNull(),
  eventDate: date("event_date", { mode: "string" }).notNull(),
  startTime: varchar("start_time", { length: 20 }),
  venue: varchar("venue", { length: 300 }),
  timezone: varchar("timezone", { length: 64 }).notNull().default("Asia/Hong_Kong"),
  status: mysqlEnum("status", ["draft", "active", "closed"]).notNull().default("active"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export const efUsers = mysqlTable(
  "ef_users",
  {
    id: int("id").autoincrement().primaryKey(),
    username: varchar("username", { length: 64 }).unique(),
    email: varchar("email", { length: 320 }).unique(),
    passwordHash: varchar("password_hash", { length: 255 }),
    name: varchar("name", { length: 120 }).notNull(),
    phone: varchar("phone", { length: 20 }),
    role: mysqlEnum("role", ["owner", "admin", "staff", "merchant", "member"]).notNull(),
    googleSub: varchar("google_sub", { length: 128 }).unique(),
    googleEmailVerified: boolean("google_email_verified").notNull().default(false),
    merchantId: int("merchant_id"),
    memberId: int("member_id"),
    isActive: boolean("is_active").notNull().default(true),
    sessionVersion: int("session_version").notNull().default(1),
    mustChangePassword: boolean("must_change_password").notNull().default(false),
    lastLoginAt: timestamp("last_login_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
  },
  (t) => [index("ef_users_role_idx").on(t.role), index("ef_users_member_idx").on(t.memberId)]
);

export const efOwnerAllowlist = mysqlTable("ef_owner_allowlist", {
  id: int("id").autoincrement().primaryKey(),
  email: varchar("email", { length: 320 }).notNull().unique(),
  label: varchar("label", { length: 120 }),
  userId: int("user_id"),
  verifiedAt: timestamp("verified_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const efMembers = mysqlTable(
  "ef_members",
  {
    id: int("id").autoincrement().primaryKey(),
    memberCode: varchar("member_code", { length: 32 }).notNull().unique(),
    name: varchar("name", { length: 120 }).notNull(),
    phone: varchar("phone", { length: 20 }).notNull(),
    email: varchar("email", { length: 320 }),
    qrToken: varchar("qr_token", { length: 64 }).notNull().unique(),
    totalSpendCents: int("total_spend_cents").notNull().default(0),
    drawChancesEarned: int("draw_chances_earned").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
  },
  (t) => [index("ef_members_phone_idx").on(t.phone), index("ef_members_name_idx").on(t.name)]
);

export const efGuests = mysqlTable(
  "ef_guests",
  {
    id: int("id").autoincrement().primaryKey(),
    publicId: varchar("public_id", { length: 40 }).notNull().unique(),
    memberId: int("member_id").notNull().unique(),
    zone: varchar("zone", { length: 80 }),
    seat: varchar("seat", { length: 80 }),
    groupName: varchar("group_name", { length: 80 }),
    registrationStatus: mysqlEnum("registration_status", ["registered", "walk_in"]).notNull().default("registered"),
    note: varchar("note", { length: 300 }),
    checkedInAt: timestamp("checked_in_at"),
    checkedInBy: int("checked_in_by"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
  },
  (t) => [index("ef_guests_zone_idx").on(t.zone), index("ef_guests_checked_idx").on(t.checkedInAt)]
);

export const efMerchants = mysqlTable("ef_merchants", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 160 }).notNull(),
  booth: varchar("booth", { length: 40 }),
  contactName: varchar("contact_name", { length: 120 }),
  phone: varchar("phone", { length: 20 }),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export const efTransactions = mysqlTable(
  "ef_transactions",
  {
    id: int("id").autoincrement().primaryKey(),
    merchantId: int("merchant_id").notNull(),
    memberId: int("member_id").notNull(),
    amountCents: int("amount_cents").notNull(),
    status: mysqlEnum("status", ["pending", "confirmed", "rejected", "expired"]).notNull().default("pending"),
    requestId: varchar("request_id", { length: 64 }).notNull(),
    note: varchar("note", { length: 300 }),
    expiresAt: timestamp("expires_at").notNull(),
    confirmedAt: timestamp("confirmed_at"),
    rejectedAt: timestamp("rejected_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
  },
  (t) => [
    uniqueIndex("ef_tx_merchant_request").on(t.merchantId, t.requestId),
    index("ef_tx_member_idx").on(t.memberId),
    index("ef_tx_status_idx").on(t.status),
    index("ef_tx_created_idx").on(t.createdAt),
  ]
);

export const efDrawTickets = mysqlTable(
  "ef_draw_tickets",
  {
    id: int("id").autoincrement().primaryKey(),
    memberId: int("member_id").notNull(),
    transactionId: int("transaction_id"),
    sequence: int("sequence").notNull(),
    code: varchar("code", { length: 40 }).notNull().unique(),
    status: mysqlEnum("status", ["available", "used"]).notNull().default("available"),
    usedAt: timestamp("used_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("ef_ticket_member_seq").on(t.memberId, t.sequence), index("ef_ticket_status_idx").on(t.status)]
);

export const efPreorders = mysqlTable(
  "ef_preorders",
  {
    id: int("id").autoincrement().primaryKey(),
    orderNo: varchar("order_no", { length: 64 }).notNull().unique(),
    merchantId: int("merchant_id").notNull(),
    memberId: int("member_id").notNull(),
    items: text("items").notNull(),
    amountCents: int("amount_cents").notNull().default(0),
    status: mysqlEnum("status", ["pending", "collected", "cancelled"]).notNull().default("pending"),
    collectedAt: timestamp("collected_at"),
    collectedBy: int("collected_by"),
    note: varchar("note", { length: 300 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
  },
  (t) => [index("ef_preorder_merchant_idx").on(t.merchantId), index("ef_preorder_member_idx").on(t.memberId), index("ef_preorder_status_idx").on(t.status)]
);

export const efDraws = mysqlTable("ef_draws", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 160 }).notNull(),
  kind: mysqlEnum("kind", ["gift", "cash", "consumer", "grand"]).notNull(),
  prizeDescription: varchar("prize_description", { length: 300 }).notNull(),
  prizeCount: int("prize_count").notNull().default(1),
  awardedCount: int("awarded_count").notNull().default(0),
  scheduledAt: timestamp("scheduled_at"),
  eligibility: mysqlEnum("eligibility", ["all_registered", "checked_in", "consumers", "tickets", "top_spenders"]).notNull(),
  maxWinsPerPerson: int("max_wins_per_person").notNull().default(1),
  shortlistSize: int("shortlist_size").notNull().default(20),
  rulesConfirmed: boolean("rules_confirmed").notNull().default(false),
  rulesNote: text("rules_note"),
  status: mysqlEnum("status", ["draft", "ready", "completed", "cancelled"]).notNull().default("draft"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export const efDrawWinners = mysqlTable(
  "ef_draw_winners",
  {
    id: int("id").autoincrement().primaryKey(),
    drawId: int("draw_id").notNull(),
    memberId: int("member_id").notNull(),
    ticketId: int("ticket_id"),
    prizeLabel: varchar("prize_label", { length: 200 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("ef_winner_draw_member").on(t.drawId, t.memberId), index("ef_winner_draw_idx").on(t.drawId)]
);

export const efAuctions = mysqlTable("ef_auctions", {
  id: int("id").autoincrement().primaryKey(),
  title: varchar("title", { length: 200 }).notNull(),
  description: text("description"),
  startingPriceCents: int("starting_price_cents").notNull(),
  minIncrementCents: int("min_increment_cents").notNull().default(1000),
  startsAt: timestamp("starts_at"),
  endsAt: timestamp("ends_at"),
  durationMinutes: int("duration_minutes"),
  status: mysqlEnum("status", ["draft", "active", "ended", "cancelled"]).notNull().default("draft"),
  paymentMethod: varchar("payment_method", { length: 300 }),
  rulesConfirmed: boolean("rules_confirmed").notNull().default(false),
  rulesNote: text("rules_note"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export const efBids = mysqlTable(
  "ef_bids",
  {
    id: int("id").autoincrement().primaryKey(),
    auctionId: int("auction_id").notNull(),
    memberId: int("member_id").notNull(),
    amountCents: int("amount_cents").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("ef_bid_auction_idx").on(t.auctionId), index("ef_bid_member_idx").on(t.memberId)]
);

export const efAuditLog = mysqlTable(
  "ef_audit_log",
  {
    id: int("id").autoincrement().primaryKey(),
    actorUserId: int("actor_user_id"),
    action: varchar("action", { length: 80 }).notNull(),
    entityType: varchar("entity_type", { length: 60 }),
    entityId: int("entity_id"),
    detail: text("detail"),
    ip: varchar("ip", { length: 64 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("ef_audit_action_idx").on(t.action), index("ef_audit_created_idx").on(t.createdAt)]
);

export const efSettings = mysqlTable("ef_settings", {
  key: varchar("key", { length: 80 }).primaryKey(),
  value: text("value"),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export const efApiKeys = mysqlTable("ef_api_keys", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 120 }).notNull(),
  keyHash: varchar("key_hash", { length: 64 }).notNull().unique(),
  prefix: varchar("prefix", { length: 20 }).notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type EfEvent = typeof efEvents.$inferSelect;
export type EfUser = typeof efUsers.$inferSelect;
export type EfMember = typeof efMembers.$inferSelect;
export type EfGuest = typeof efGuests.$inferSelect;
export type EfMerchant = typeof efMerchants.$inferSelect;
export type EfTransaction = typeof efTransactions.$inferSelect;
export type EfDrawTicket = typeof efDrawTickets.$inferSelect;
export type EfPreorder = typeof efPreorders.$inferSelect;
export type EfDraw = typeof efDraws.$inferSelect;
export type EfDrawWinner = typeof efDrawWinners.$inferSelect;
export type EfAuction = typeof efAuctions.$inferSelect;
export type EfBid = typeof efBids.$inferSelect;
export type EfOwnerAllowlist = typeof efOwnerAllowlist.$inferSelect;
