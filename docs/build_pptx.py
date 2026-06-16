"""Build pharmacy-bin-keeper pitch deck."""
from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN
from pptx.util import Inches, Pt

# ── colour palette ──────────────────────────────────────────────────────────
NAVY    = RGBColor(0x1B, 0x4F, 0x8A)   # dark blue (sidebar colour)
WHITE   = RGBColor(0xFF, 0xFF, 0xFF)
ACCENT  = RGBColor(0x27, 0xAE, 0x60)   # green
AMBER   = RGBColor(0xF3, 0x9C, 0x12)
RED     = RGBColor(0xE7, 0x4C, 0x3C)
LIGHT   = RGBColor(0xF0, 0xF4, 0xF8)
GREY    = RGBColor(0x4A, 0x55, 0x68)
DARK    = RGBColor(0x1A, 0x20, 0x2C)

W = Inches(13.33)
H = Inches(7.5)

prs = Presentation()
prs.slide_width  = W
prs.slide_height = H

BLANK = prs.slide_layouts[6]   # completely blank


# ── helpers ─────────────────────────────────────────────────────────────────
def add_rect(slide, x, y, w, h, fill_rgb, alpha=None):
    shape = slide.shapes.add_shape(1, x, y, w, h)   # MSO_SHAPE_TYPE.RECTANGLE = 1
    shape.line.fill.background()
    shape.fill.solid()
    shape.fill.fore_color.rgb = fill_rgb
    return shape


def txb(slide, text, x, y, w, h,
        size=20, bold=False, color=WHITE, align=PP_ALIGN.LEFT,
        wrap=True, italic=False):
    tb = slide.shapes.add_textbox(x, y, w, h)
    tb.word_wrap = wrap
    tf = tb.text_frame
    tf.word_wrap = wrap
    p  = tf.paragraphs[0]
    p.alignment = align
    run = p.add_run()
    run.text = text
    run.font.size  = Pt(size)
    run.font.bold  = bold
    run.font.color.rgb = color
    run.font.italic = italic
    return tb


def bullet_box(slide, items, x, y, w, h,
               size=16, color=DARK, title=None, title_color=NAVY):
    tb = slide.shapes.add_textbox(x, y, w, h)
    tb.word_wrap = True
    tf = tb.text_frame
    tf.word_wrap = True
    first = True
    if title:
        p = tf.paragraphs[0] if first else tf.add_paragraph()
        first = False
        p.alignment = PP_ALIGN.LEFT
        r = p.add_run()
        r.text = title
        r.font.size = Pt(size + 2)
        r.font.bold = True
        r.font.color.rgb = title_color
    for item in items:
        p = tf.paragraphs[0] if (first and not title) else tf.add_paragraph()
        first = False
        p.alignment = PP_ALIGN.LEFT
        p.space_before = Pt(4)
        r = p.add_run()
        r.text = item
        r.font.size  = Pt(size)
        r.font.color.rgb = color


# ════════════════════════════════════════════════════════════════════════════
# SLIDE 1 — COVER
# ════════════════════════════════════════════════════════════════════════════
s = prs.slides.add_slide(BLANK)

# full navy background
add_rect(s, 0, 0, W, H, NAVY)

# left accent bar (green)
add_rect(s, 0, 0, Inches(0.25), H, ACCENT)

# product name
txb(s, "Pharmacy Bin Keeper", Inches(0.6), Inches(1.8), Inches(8), Inches(1.2),
    size=48, bold=True, color=WHITE)

# tagline
txb(s, "Smart Drug Inventory & Dispensing Management for Klinik Kesihatan",
    Inches(0.6), Inches(3.0), Inches(9), Inches(0.8),
    size=22, color=RGBColor(0xA8, 0xC4, 0xE8), italic=True)

# "Kawalan Ubat KK Kempas"
txb(s, "Kawalan Ubat KK Kempas", Inches(0.6), Inches(4.0), Inches(7), Inches(0.5),
    size=16, color=ACCENT)

# bottom strip
add_rect(s, 0, Inches(6.9), W, Inches(0.6), RGBColor(0x12, 0x35, 0x62))
txb(s, "Confidential · 2026", Inches(0.6), Inches(6.9), Inches(6), Inches(0.6),
    size=12, color=RGBColor(0x90, 0xA8, 0xC0))


# ════════════════════════════════════════════════════════════════════════════
# SLIDE 2 — THE PROBLEM
# ════════════════════════════════════════════════════════════════════════════
s = prs.slides.add_slide(BLANK)
add_rect(s, 0, 0, W, H, LIGHT)
add_rect(s, 0, 0, W, Inches(1.4), NAVY)
add_rect(s, 0, 0, Inches(0.25), H, RED)

txb(s, "The Problem", Inches(0.55), Inches(0.25), Inches(10), Inches(0.8),
    size=32, bold=True, color=WHITE)
txb(s, "Malaysian public-clinic pharmacies still run on paper bin cards and spreadsheets",
    Inches(0.55), Inches(0.85), Inches(11), Inches(0.5),
    size=15, color=RGBColor(0xB0, 0xC8, 0xE8))

problems = [
    ("📋  Manual Bin Cards",
     "Paper stock cards go out of sync the moment stock moves. Errors accumulate silently."),
    ("⚠️  No Approval Workflow",
     "Doctor requests, antibiotic Clinical-Pathway approvals and specialist sign-offs travel via WhatsApp or physical forms."),
    ("📦  Blind Spots in Controlled Drugs",
     "No real-time visibility on controlled-drug quotas, leading to over-dispensing or patient denials."),
    ("🔁  Disconnected Teams",
     "MOs, FMS specialists, and pharmacists work in silos — no shared state, no audit trail."),
]

col_w = Inches(5.8)
positions = [
    (Inches(0.5),  Inches(1.6)),
    (Inches(6.9),  Inches(1.6)),
    (Inches(0.5),  Inches(4.2)),
    (Inches(6.9),  Inches(4.2)),
]
card_h = Inches(2.3)

for (title, body), (cx, cy) in zip(problems, positions):
    add_rect(s, cx, cy, col_w, card_h, WHITE)
    txb(s, title, cx + Inches(0.2), cy + Inches(0.15), col_w - Inches(0.4), Inches(0.55),
        size=16, bold=True, color=DARK)
    txb(s, body,  cx + Inches(0.2), cy + Inches(0.7),  col_w - Inches(0.4), Inches(1.4),
        size=13, color=GREY, wrap=True)


# ════════════════════════════════════════════════════════════════════════════
# SLIDE 3 — OUR SOLUTION
# ════════════════════════════════════════════════════════════════════════════
s = prs.slides.add_slide(BLANK)
add_rect(s, 0, 0, W, H, LIGHT)
add_rect(s, 0, 0, W, Inches(1.4), NAVY)
add_rect(s, 0, 0, Inches(0.25), H, ACCENT)

txb(s, "Our Solution", Inches(0.55), Inches(0.25), Inches(10), Inches(0.8),
    size=32, bold=True, color=WHITE)
txb(s, "A unified, role-aware web app that digitises every step of clinic pharmacy operations",
    Inches(0.55), Inches(0.85), Inches(11), Inches(0.5),
    size=15, color=RGBColor(0xB0, 0xC8, 0xE8))

solutions = [
    ("Real-Time Stock Ledger",   "Live bin-card view computed from a tamper-evident transactions ledger. No sync lag."),
    ("Multi-Step Approval Flow", "MO request → FMS review → Pharmacist fulfilment. Every handoff is timestamped and auditable."),
    ("Antibiotic Stewardship",   "NAG 2024 Clinical Pathway forms built in. FMS approves; pharmacist acknowledges before dispensing."),
    ("Quota Tracking",           "Annual controlled-drug quota per patient visible in real time; pesara (retiree) quota tracked separately."),
    ("Role-Based Dashboards",    "Each role (admin, pharmacist, MO, FMS) sees only what they need — pending counts, stock alerts, approval queues."),
    ("Audit & Reports",          "Full ledger history, patient drug records, and exportable laporan. AI audit log for every AI-assisted action."),
]

cols = 3
for i, (title, body) in enumerate(solutions):
    col = i % cols
    row = i // cols
    cx = Inches(0.4) + col * Inches(4.25)
    cy = Inches(1.65) + row * Inches(2.55)
    cw = Inches(4.0)
    ch = Inches(2.3)
    add_rect(s, cx, cy, cw, ch, WHITE)
    add_rect(s, cx, cy, cw, Inches(0.06), ACCENT)  # top accent line
    txb(s, title, cx + Inches(0.2), cy + Inches(0.15), cw - Inches(0.4), Inches(0.55),
        size=15, bold=True, color=NAVY)
    txb(s, body,  cx + Inches(0.2), cy + Inches(0.7),  cw - Inches(0.4), Inches(1.4),
        size=12, color=GREY, wrap=True)


# ════════════════════════════════════════════════════════════════════════════
# SLIDE 4 — HOW IT WORKS (Workflow)
# ════════════════════════════════════════════════════════════════════════════
s = prs.slides.add_slide(BLANK)
add_rect(s, 0, 0, W, H, WHITE)
add_rect(s, 0, 0, W, Inches(1.4), NAVY)
add_rect(s, 0, 0, Inches(0.25), H, AMBER)

txb(s, "How It Works", Inches(0.55), Inches(0.25), Inches(10), Inches(0.8),
    size=32, bold=True, color=WHITE)
txb(s, "End-to-end digital workflow from request to dispensing",
    Inches(0.55), Inches(0.85), Inches(11), Inches(0.5),
    size=15, color=RGBColor(0xB0, 0xC8, 0xE8))

steps = [
    ("1", "MO Submits\nRequest",     "Doctor selects drug,\npatient IC & quantity\n(Ubat or Antibiotik form)", NAVY),
    ("2", "FMS Reviews",             "Family Medicine\nSpecialist approves or\nrejects with notes",          AMBER),
    ("3", "Pharmacist\nFulfils",     "Pharmacy queues up\napproved requests\nand dispenses",                 ACCENT),
    ("4", "Ledger &\nRecords",       "Stock ledger updated;\npatient registry &\ndrug history saved",        RGBColor(0x2D, 0x86, 0xC9)),
]

arrow_y = Inches(3.6)
step_y  = Inches(1.7)
box_w   = Inches(2.6)
box_h   = Inches(3.8)
gap     = Inches(0.6)
start_x = Inches(0.5)

for i, (num, title, body, color) in enumerate(steps):
    cx = start_x + i * (box_w + gap)
    add_rect(s, cx, step_y, box_w, box_h, LIGHT)
    add_rect(s, cx, step_y, box_w, Inches(0.06), color)
    # circle number
    circ = s.shapes.add_shape(9, cx + Inches(0.9), step_y + Inches(0.15),
                               Inches(0.8), Inches(0.8))   # 9 = oval
    circ.fill.solid(); circ.fill.fore_color.rgb = color
    circ.line.fill.background()
    tf = circ.text_frame; tf.word_wrap = False
    p = tf.paragraphs[0]; p.alignment = PP_ALIGN.CENTER
    r = p.add_run(); r.text = num; r.font.size = Pt(18); r.font.bold = True
    r.font.color.rgb = WHITE

    txb(s, title, cx + Inches(0.15), step_y + Inches(1.1), box_w - Inches(0.3), Inches(0.8),
        size=15, bold=True, color=DARK, align=PP_ALIGN.CENTER)
    txb(s, body, cx + Inches(0.15), step_y + Inches(1.95), box_w - Inches(0.3), Inches(1.6),
        size=12, color=GREY, align=PP_ALIGN.CENTER, wrap=True)

    # arrow between boxes
    if i < len(steps) - 1:
        ax = cx + box_w + Inches(0.05)
        txb(s, "→", ax, arrow_y, gap, Inches(0.5),
            size=28, bold=True, color=GREY, align=PP_ALIGN.CENTER)


# ════════════════════════════════════════════════════════════════════════════
# SLIDE 5 — ROLES & DASHBOARDS
# ════════════════════════════════════════════════════════════════════════════
s = prs.slides.add_slide(BLANK)
add_rect(s, 0, 0, W, H, LIGHT)
add_rect(s, 0, 0, W, Inches(1.4), NAVY)
add_rect(s, 0, 0, Inches(0.25), H, RGBColor(0x2D, 0x86, 0xC9))

txb(s, "Role-Based Dashboards", Inches(0.55), Inches(0.25), Inches(10), Inches(0.8),
    size=32, bold=True, color=WHITE)
txb(s, "Every user sees exactly what they need — no information overload",
    Inches(0.55), Inches(0.85), Inches(11), Inches(0.5),
    size=15, color=RGBColor(0xB0, 0xC8, 0xE8))

roles = [
    ("👨‍⚕️  Medical Officer (MO)", NAVY, [
        "Submit drug dispensing requests",
        "Submit antibiotic Clinical Pathway forms (NAG 2024)",
        "Track request status in real time",
        "Access MO dashboard & pending counts",
    ]),
    ("🩺  FMS Specialist", AMBER, [
        "Review & approve / reject all MO requests",
        "Approve antibiotic forms with specialist notes",
        "Monitor controlled-drug annual quotas",
        "View drug usage trends & forecasts",
    ]),
    ("💊  Pharmacist / Admin", ACCENT, [
        "Fulfil approved dispensing requests",
        "Acknowledge antibiotic forms post-approval",
        "Manage drug master, stock receipts (Terimaan)",
        "View bin card, ledger, patient registry & reports",
    ]),
]

col_w = Inches(3.9)
for i, (role, color, items) in enumerate(roles):
    cx = Inches(0.45) + i * Inches(4.25)
    cy = Inches(1.6)
    ch = Inches(5.5)
    add_rect(s, cx, cy, col_w, ch, WHITE)
    add_rect(s, cx, cy, col_w, Inches(0.08), color)
    txb(s, role, cx + Inches(0.2), cy + Inches(0.2), col_w - Inches(0.3), Inches(0.6),
        size=15, bold=True, color=color)
    bullet_box(s, ["• " + it for it in items],
               cx + Inches(0.2), cy + Inches(0.9), col_w - Inches(0.3), ch - Inches(1.1),
               size=12, color=GREY)


# ════════════════════════════════════════════════════════════════════════════
# SLIDE 6 — KEY FEATURES
# ════════════════════════════════════════════════════════════════════════════
s = prs.slides.add_slide(BLANK)
add_rect(s, 0, 0, W, H, WHITE)
add_rect(s, 0, 0, W, Inches(1.4), NAVY)
add_rect(s, 0, 0, Inches(0.25), H, ACCENT)

txb(s, "Key Features", Inches(0.55), Inches(0.25), Inches(10), Inches(0.8),
    size=32, bold=True, color=WHITE)
txb(s, "Purpose-built for Malaysian Klinik Kesihatan operations",
    Inches(0.55), Inches(0.85), Inches(11), Inches(0.5),
    size=15, color=RGBColor(0xB0, 0xC8, 0xE8))

features = [
    ("📊", "Live Stock Dashboard",        "KRITIKAL / RENDAH / NORMAL / LEBIHAN status badges. Auto-refresh every 15–30 seconds."),
    ("📋", "Digital Bin Card & Ledger",   "Per-drug ledger with full terimaan/keluaran history. Printable bin-card view."),
    ("💉", "Antibiotic Stewardship",      "Built-in NAG 2024 Clinical Pathway checklist. FMS approval gate before dispensing."),
    ("🔐", "Controlled Drug Quotas",      "Annual patient quota per controlled drug. Pesara (retiree) tracked separately."),
    ("🗂️", "Patient Registry",            "Auto-created on first dispensing. Full drug history per patient IC."),
    ("📈", "Usage Forecasting",           "30-day rolling average + projected stock exhaustion date per drug."),
    ("🛡️", "Role-Based Access Control",   "4 roles, granular route protection. No cross-role data leakage."),
    ("📝", "Full Audit Trail",            "Every approval, rejection, and dispensing is timestamped and attributed."),
]

cols = 4
for i, (icon, title, body) in enumerate(features):
    col = i % cols
    row = i // cols
    cx = Inches(0.35) + col * Inches(3.2)
    cy = Inches(1.65) + row * Inches(2.6)
    cw = Inches(3.0)
    ch = Inches(2.4)
    add_rect(s, cx, cy, cw, ch, LIGHT)
    txb(s, icon,  cx + Inches(0.15), cy + Inches(0.15), Inches(0.6), Inches(0.5), size=22, color=DARK)
    txb(s, title, cx + Inches(0.15), cy + Inches(0.65), cw - Inches(0.3), Inches(0.5),
        size=13, bold=True, color=NAVY)
    txb(s, body,  cx + Inches(0.15), cy + Inches(1.15), cw - Inches(0.3), Inches(1.1),
        size=11, color=GREY, wrap=True)


# ════════════════════════════════════════════════════════════════════════════
# SLIDE 7 — TECH STACK
# ════════════════════════════════════════════════════════════════════════════
s = prs.slides.add_slide(BLANK)
add_rect(s, 0, 0, W, H, LIGHT)
add_rect(s, 0, 0, W, Inches(1.4), NAVY)
add_rect(s, 0, 0, Inches(0.25), H, RGBColor(0x8E, 0x44, 0xAD))

txb(s, "Technology Stack", Inches(0.55), Inches(0.25), Inches(10), Inches(0.8),
    size=32, bold=True, color=WHITE)
txb(s, "Modern, proven, cloud-native — zero infrastructure to manage",
    Inches(0.55), Inches(0.85), Inches(11), Inches(0.5),
    size=15, color=RGBColor(0xB0, 0xC8, 0xE8))

layers = [
    ("Frontend",       NAVY,                      ["React 18 + TypeScript", "Vite (SWC) · Port 8080", "React Router v6", "TanStack Query (server state)"]),
    ("UI / Design",    RGBColor(0x2D, 0x86, 0xC9), ["shadcn/ui (Radix primitives)", "Tailwind CSS", "Recharts (dashboards)", "Lucide icons"]),
    ("Backend / Data", ACCENT,                    ["Supabase (PostgreSQL)", "Row-Level Security (RLS)", "Supabase Auth (JWT)", "Real-time subscriptions"]),
    ("Forms / QA",     AMBER,                     ["React Hook Form + Zod", "Vitest (unit tests)", "Playwright (E2E)", "ESLint + TypeScript strict"]),
]

col_w = Inches(2.9)
for i, (layer, color, items) in enumerate(layers):
    cx = Inches(0.5) + i * Inches(3.1)
    cy = Inches(1.6)
    ch = Inches(5.5)
    add_rect(s, cx, cy, col_w, ch, WHITE)
    add_rect(s, cx, cy, col_w, Inches(0.45), color)
    txb(s, layer, cx + Inches(0.15), cy + Inches(0.05), col_w - Inches(0.3), Inches(0.4),
        size=15, bold=True, color=WHITE)
    bullet_box(s, ["▸ " + it for it in items],
               cx + Inches(0.2), cy + Inches(0.6), col_w - Inches(0.3), ch - Inches(0.7),
               size=13, color=GREY)


# ════════════════════════════════════════════════════════════════════════════
# SLIDE 8 — SECURITY & COMPLIANCE
# ════════════════════════════════════════════════════════════════════════════
s = prs.slides.add_slide(BLANK)
add_rect(s, 0, 0, W, H, WHITE)
add_rect(s, 0, 0, W, Inches(1.4), NAVY)
add_rect(s, 0, 0, Inches(0.25), H, RED)

txb(s, "Security & Compliance", Inches(0.55), Inches(0.25), Inches(10), Inches(0.8),
    size=32, bold=True, color=WHITE)
txb(s, "Healthcare-grade data protection built in from day one",
    Inches(0.55), Inches(0.85), Inches(11), Inches(0.5),
    size=15, color=RGBColor(0xB0, 0xC8, 0xE8))

sec_items = [
    ("🔐  Row-Level Security (RLS)",
     "Every Supabase table enforces RLS. Users can only read/write data their role permits — enforced at the database layer, not just the UI."),
    ("🛡️  Role-Based Access Control",
     "4 distinct roles (admin, pharmacist, MO, FMS). Route guards and sidebar navigation are role-aware. Cross-role data access is structurally impossible."),
    ("📜  Full Audit Trail",
     "All dispensing approvals, rejections, and fulfilments are attributed to a user with a timestamp. AI-assisted actions log to ai_audit_logs (user, role, tokens, status)."),
    ("🔑  Supabase Auth (JWT)",
     "Industry-standard JWT-based authentication. Sessions are scoped and signed. No passwords stored in the application layer."),
    ("🩺  Antibiotic Stewardship (NAG 2024)",
     "Antibiotic dispensing cannot be fulfilled without FMS specialist sign-off. Clinical Pathway checklist is mandatory and stored per request."),
    ("📦  Controlled Drug Quotas",
     "Annual quota limits enforced at application level with real-time remaining-quota display. Prevents over-dispensing to any patient or pesara cohort."),
]

for i, (title, body) in enumerate(sec_items):
    row = i % 3
    col = i // 3
    cx = Inches(0.5) + col * Inches(6.4)
    cy = Inches(1.6) + row * Inches(1.85)
    cw = Inches(6.0)
    ch = Inches(1.7)
    add_rect(s, cx, cy, cw, ch, LIGHT)
    txb(s, title, cx + Inches(0.2), cy + Inches(0.1), cw - Inches(0.3), Inches(0.5),
        size=14, bold=True, color=NAVY)
    txb(s, body, cx + Inches(0.2), cy + Inches(0.6), cw - Inches(0.3), Inches(0.95),
        size=11, color=GREY, wrap=True)


# ════════════════════════════════════════════════════════════════════════════
# SLIDE 9 — DEPLOYMENT
# ════════════════════════════════════════════════════════════════════════════
s = prs.slides.add_slide(BLANK)
add_rect(s, 0, 0, W, H, LIGHT)
add_rect(s, 0, 0, W, Inches(1.4), NAVY)
add_rect(s, 0, 0, Inches(0.25), H, AMBER)

txb(s, "Deployment & Operations", Inches(0.55), Inches(0.25), Inches(10), Inches(0.8),
    size=32, bold=True, color=WHITE)
txb(s, "Cloud-first — live in minutes, no servers to maintain",
    Inches(0.55), Inches(0.85), Inches(11), Inches(0.5),
    size=15, color=RGBColor(0xB0, 0xC8, 0xE8))

dep_blocks = [
    ("☁️  Frontend Hosting",  NAVY,  [
        "Deployed on Vercel (vercel.json configured)",
        "Global CDN — fast load anywhere in Malaysia",
        "Preview deployments per branch",
        "Zero-downtime rollouts",
    ]),
    ("🗄️  Database & Auth",   ACCENT, [
        "Supabase managed PostgreSQL",
        "Automatic daily backups",
        "Built-in connection pooling",
        "Point-in-time recovery available",
    ]),
    ("⚙️  DevOps",            AMBER,  [
        "CI/CD via Vercel git integration",
        "Supabase migrations versioned in repo",
        "Environment variables via .env (VITE_SUPABASE_*)",
        "Health monitored via Supabase dashboard",
    ]),
]

col_w = Inches(3.7)
for i, (title, color, items) in enumerate(dep_blocks):
    cx = Inches(0.5) + i * Inches(4.1)
    cy = Inches(1.65)
    ch = Inches(5.5)
    add_rect(s, cx, cy, col_w, ch, WHITE)
    add_rect(s, cx, cy, col_w, Inches(0.08), color)
    txb(s, title, cx + Inches(0.2), cy + Inches(0.2), col_w - Inches(0.3), Inches(0.6),
        size=16, bold=True, color=color)
    bullet_box(s, ["✓  " + it for it in items],
               cx + Inches(0.2), cy + Inches(0.9), col_w - Inches(0.3), ch - Inches(1.1),
               size=12, color=GREY)


# ════════════════════════════════════════════════════════════════════════════
# SLIDE 10 — ROADMAP
# ════════════════════════════════════════════════════════════════════════════
s = prs.slides.add_slide(BLANK)
add_rect(s, 0, 0, W, H, WHITE)
add_rect(s, 0, 0, W, Inches(1.4), NAVY)
add_rect(s, 0, 0, Inches(0.25), H, ACCENT)

txb(s, "Product Roadmap", Inches(0.55), Inches(0.25), Inches(10), Inches(0.8),
    size=32, bold=True, color=WHITE)
txb(s, "From single clinic to network-wide rollout",
    Inches(0.55), Inches(0.85), Inches(11), Inches(0.5),
    size=15, color=RGBColor(0xB0, 0xC8, 0xE8))

phases = [
    ("✅  Phase 1\n(Done)",       ACCENT, [
        "Core drug master & stock ledger",
        "MO dispensing request flow",
        "FMS specialist approval dashboard",
        "Antibiotic stewardship (NAG 2024)",
        "Pharmacist fulfilment queue",
        "Patient registry & drug history",
        "Annual quota tracking",
    ]),
    ("🔄  Phase 2\n(In Progress)", AMBER, [
        "E-prescription PDF export",
        "SMS / push notifications (pending approval)",
        "Barcode / QR scanning for drug receipt",
        "Advanced laporan (XLSX / PDF exports)",
        "Multi-facility support (facility switcher)",
    ]),
    ("🚀  Phase 3\n(Planned)",    NAVY, [
        "MOH JKN integration (eLesen / ePerolehan)",
        "AI-powered stock forecasting",
        "Drug interaction alerts",
        "Network-wide analytics across KK branches",
        "Mobile app (React Native wrapper)",
    ]),
]

col_w = Inches(3.7)
for i, (phase, color, items) in enumerate(phases):
    cx = Inches(0.5) + i * Inches(4.1)
    cy = Inches(1.65)
    ch = Inches(5.5)
    add_rect(s, cx, cy, col_w, ch, LIGHT)
    add_rect(s, cx, cy, col_w, Inches(0.08), color)
    txb(s, phase, cx + Inches(0.2), cy + Inches(0.15), col_w - Inches(0.3), Inches(0.7),
        size=16, bold=True, color=color)
    bullet_box(s, ["• " + it for it in items],
               cx + Inches(0.2), cy + Inches(0.95), col_w - Inches(0.3), ch - Inches(1.1),
               size=12, color=GREY)


# ════════════════════════════════════════════════════════════════════════════
# SLIDE 11 — CLOSING
# ════════════════════════════════════════════════════════════════════════════
s = prs.slides.add_slide(BLANK)
add_rect(s, 0, 0, W, H, NAVY)
add_rect(s, 0, 0, Inches(0.25), H, ACCENT)

txb(s, "Pharmacy Bin Keeper", Inches(0.6), Inches(1.5), Inches(10), Inches(1.1),
    size=44, bold=True, color=WHITE)
txb(s, "Digitising drug inventory management for Malaysian public-sector clinics —\none request, one approval, one dispense at a time.",
    Inches(0.6), Inches(2.75), Inches(10), Inches(1.2),
    size=20, color=RGBColor(0xA8, 0xC4, 0xE8), italic=True, wrap=True)

txb(s, "Contact  ·  admin@vvsdigitalsolutions.com",
    Inches(0.6), Inches(4.6), Inches(8), Inches(0.6),
    size=16, color=ACCENT)

add_rect(s, 0, Inches(6.9), W, Inches(0.6), RGBColor(0x12, 0x35, 0x62))
txb(s, "vvsdigitalsolutions.com  ·  Confidential 2026",
    Inches(0.6), Inches(6.9), Inches(10), Inches(0.6),
    size=12, color=RGBColor(0x90, 0xA8, 0xC0))


# ── Save ─────────────────────────────────────────────────────────────────────
out = "/home/user/pharmacy-bin-keeper/docs/pharmacy-bin-keeper-deck.pptx"
prs.save(out)
print(f"Saved → {out}")
