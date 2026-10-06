from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN
from pptx.util import Inches, Pt
import copy

# Colors
BG       = RGBColor(0x0a, 0x0a, 0x0a)
CARD_BG  = RGBColor(0x14, 0x14, 0x14)
AMBER    = RGBColor(0xF5, 0x9E, 0x0B)
GREEN    = RGBColor(0x22, 0xC5, 0x5E)
BLUE     = RGBColor(0x60, 0xA5, 0xFA)
PURPLE   = RGBColor(0xC0, 0x84, 0xFC)
WHITE    = RGBColor(0xFF, 0xFF, 0xFF)
GRAY     = RGBColor(0x99, 0x99, 0x99)
DGRAY    = RGBColor(0x44, 0x44, 0x44)
LGRAY    = RGBColor(0xCC, 0xCC, 0xCC)

W = Inches(13.33)
H = Inches(7.5)

prs = Presentation()
prs.slide_width  = W
prs.slide_height = H

blank_layout = prs.slide_layouts[6]  # blank

# ─── Helpers ──────────────────────────────────────────────────────────────────

def add_slide():
    s = prs.slides.add_slide(blank_layout)
    bg = s.background
    fill = bg.fill
    fill.solid()
    fill.fore_color.rgb = BG
    return s

def box(slide, x, y, w, h, fill=None, border=None):
    shape = slide.shapes.add_shape(1, x, y, w, h)   # MSO_SHAPE_TYPE.RECTANGLE = 1
    shape.line.fill.background()
    if fill:
        shape.fill.solid()
        shape.fill.fore_color.rgb = fill
    else:
        shape.fill.background()
    if border:
        shape.line.color.rgb = border
        shape.line.width = Pt(1)
    else:
        shape.line.fill.background()
    return shape

def txt(slide, text, x, y, w, h,
        size=18, bold=False, color=WHITE,
        align=PP_ALIGN.LEFT, wrap=True):
    tf = slide.shapes.add_textbox(x, y, w, h)
    tf.word_wrap = wrap
    p = tf.text_frame.paragraphs[0]
    p.alignment = align
    run = p.add_run()
    run.text = text
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.color.rgb = color
    run.font.name = "Calibri"
    return tf

def tag(slide, text, x=Inches(0.6), y=Inches(0.45)):
    txt(slide, text.upper(), x, y, Inches(6), Inches(0.35),
        size=10, bold=True, color=AMBER)

def heading(slide, text, x=Inches(0.6), y=Inches(0.85), w=Inches(12), size=38):
    txt(slide, text, x, y, w, Inches(1.4), size=size, bold=True, color=WHITE)

def subtext(slide, text, x=Inches(0.6), y=Inches(2.0), w=Inches(9), size=16, color=GRAY):
    txt(slide, text, x, y, w, Inches(1.2), size=size, color=color)

def card(slide, x, y, w, h, label, value, sub, accent=AMBER):
    box(slide, x, y, w, h, fill=CARD_BG, border=RGBColor(0x2a,0x2a,0x2a))
    txt(slide, label.upper(), x+Inches(0.2), y+Inches(0.18), w-Inches(0.4), Inches(0.3),
        size=9, bold=True, color=DGRAY)
    txt(slide, value, x+Inches(0.2), y+Inches(0.48), w-Inches(0.4), Inches(0.7),
        size=28, bold=True, color=accent)
    txt(slide, sub, x+Inches(0.2), y+Inches(1.1), w-Inches(0.4), Inches(0.5),
        size=11, color=GRAY)

def bullet(slide, icon, text, x, y, w):
    txt(slide, icon, x, y, Inches(0.4), Inches(0.4), size=15, color=WHITE)
    txt(slide, text, x+Inches(0.42), y+Inches(0.03), w-Inches(0.5), Inches(0.4),
        size=14, color=LGRAY)


# ─── SLIDE 1: INTRO ───────────────────────────────────────────────────────────
s1 = add_slide()
tag(s1, "ClubCheck — Sales Overview")
heading(s1, "Sell the gym software\ngyms actually want.", y=Inches(0.85), size=36)
subtext(s1, "Modern gym management platform — check-ins, members,\nbilling, analytics — built for small to mid-size gyms.",
        y=Inches(2.3), size=15)

CW = Inches(3.8); CH = Inches(1.55); CY = Inches(3.65); GAP = Inches(0.22)
card(s1, Inches(0.6),       CY, CW, CH, "Starter Plan",   "$49.99/mo", "Up to 75 members",  AMBER)
card(s1, Inches(0.6)+CW+GAP, CY, CW, CH, "Pro Plan",      "$99.99/mo", "Up to 150 members", GREEN)
card(s1, Inches(0.6)+2*(CW+GAP), CY, CW, CH, "Annual (any plan)", "Save $100–$200", "Paid upfront — big close incentive", BLUE)


# ─── SLIDE 2: PRODUCT ─────────────────────────────────────────────────────────
s2 = add_slide()
tag(s2, "The Product")
heading(s2, "What ClubCheck does for a gym", size=32)

left  = [("📲","QR code & kiosk check-ins — no apps needed"),
         ("👥","Full member management — profiles, streaks, notes"),
         ("📢","Broadcast messaging to all members"),
         ("📋","Digital waivers on sign-up")]
right = [("📊","Analytics & attendance tracking"),
         ("💳","Invoicing & prospect pipeline"),
         ("🌙","Light / dark / auto theme"),
         ("🔒","Staff roles — owner, manager, front desk")]

for i,(icon,text) in enumerate(left):
    bullet(s2, icon, text, Inches(0.6), Inches(1.85)+i*Inches(0.72), Inches(5.8))
for i,(icon,text) in enumerate(right):
    bullet(s2, icon, text, Inches(6.9), Inches(1.85)+i*Inches(0.72), Inches(6.0))

subtext(s2, "14-day free trial · No credit card needed · Easy to get a gym owner in the door",
        y=Inches(5.0), size=13, color=RGBColor(0x55,0x55,0x55))


# ─── SLIDE 3: COMMISSION ──────────────────────────────────────────────────────
s3 = add_slide()
tag(s3, "Commission Structure")
heading(s3, "Two ways to earn", size=34)

def comm_box(slide, x, y, w, h, title, rows, pill_text, pill_color):
    box(slide, x, y, w, h, fill=RGBColor(0x11,0x11,0x11), border=RGBColor(0x2a,0x2a,0x2a))
    txt(slide, title, x+Inches(0.25), y+Inches(0.2), w-Inches(0.5), Inches(0.4),
        size=16, bold=True, color=WHITE)
    for i,(period, pct, pct_color) in enumerate(rows):
        ry = y + Inches(0.75) + i*Inches(0.62)
        box(slide, x+Inches(0.2), ry+Inches(0.25), w-Inches(0.4), Pt(1),
            fill=RGBColor(0x1f,0x1f,0x1f))
        txt(slide, period, x+Inches(0.25), ry, Inches(2.8), Inches(0.55),
            size=13, color=GRAY)
        txt(slide, pct, x+Inches(3.1), ry, w-Inches(3.3), Inches(0.55),
            size=13, bold=True, color=pct_color)
    # pill
    pill_x = x + Inches(0.25)
    pill_y = y + h - Inches(0.72)
    pb = box(slide, pill_x, pill_y, w-Inches(0.5), Inches(0.42),
             fill=RGBColor(0x1a,0x1a,0x0a), border=RGBColor(0x44,0x38,0x00))
    txt(slide, pill_text, pill_x+Inches(0.15), pill_y+Inches(0.07), w-Inches(0.8), Inches(0.35),
        size=11, bold=True, color=pill_color)

BW = Inches(5.9); BH = Inches(4.2); BY = Inches(1.85)
comm_box(s3, Inches(0.55), BY, BW, BH,
         "Option A — Front-Loaded",
         [("Months 1–3", "100% of monthly fee", AMBER),
          ("Months 4–9", "50% of monthly fee",  RGBColor(0xFB,0x92,0x3C)),
          ("After month 9","Commission ends",    DGRAY)],
         "Best if closing fast / high volume", AMBER)

comm_box(s3, Inches(6.88), BY, BW, BH,
         "Option B — Long-Tail",
         [("Months 1–18", "30% of monthly fee", BLUE),
          ("After month 18","Commission ends",   DGRAY)],
         "Best for steady recurring income", BLUE)


# ─── SLIDE 4: EARNING POTENTIAL ───────────────────────────────────────────────
s4 = add_slide()
tag(s4, "Earning Potential")
heading(s4, "What the numbers look like", size=32)

# Option A label
txt(s4, "OPTION A — FRONT-LOADED (9 months)", Inches(0.6), Inches(1.75), Inches(5.8), Inches(0.3),
    size=9, bold=True, color=AMBER)
# Option B label
txt(s4, "OPTION B — LONG-TAIL (18 months)", Inches(6.9), Inches(1.75), Inches(5.8), Inches(0.3),
    size=9, bold=True, color=BLUE)

SCH = Inches(1.3)
card(s4, Inches(0.6),  Inches(2.05), Inches(5.8), SCH, "Starter · $49.99/mo", "~$300", "$150 (mo 1–3)  +  $150 (mo 4–9)", AMBER)
card(s4, Inches(0.6),  Inches(3.45), Inches(5.8), SCH, "Pro · $99.99/mo",     "~$600", "$300 (mo 1–3)  +  $300 (mo 4–9)", AMBER)
card(s4, Inches(6.9),  Inches(2.05), Inches(5.8), SCH, "Starter · $49.99/mo", "~$270", "30% × $49.99 × 18 months", BLUE)
card(s4, Inches(6.9),  Inches(3.45), Inches(5.8), SCH, "Pro · $99.99/mo",     "~$540", "30% × $99.99 × 18 months", BLUE)

# Bonuses
BW2 = Inches(5.9)
card(s4, Inches(0.6),  Inches(4.85), BW2, SCH,
     "10-Customer Milestone Bonus", "+$500 cash",
     "One-time when 10 customers are actively paying", GREEN)
card(s4, Inches(6.9),  Inches(4.85), BW2, SCH,
     "Annual Plan Bonus", "+$49.99 or +$99.99",
     "Extra 1 month's fee when customer pays the full year upfront", PURPLE)


# ─── SLIDE 5: YOUR TOOLS ──────────────────────────────────────────────────────
s5 = add_slide()
tag(s5, "Sales Rep Portal")
heading(s5, "Everything you need to sell", size=34)

tools_left  = [("🔗","Unique referral link — every signup auto-attributed to you"),
               ("📷","QR code — show on an iPad or print it at a gym"),
               ("📈","Live funnel — see signed up → verified → trialing → paid")]
tools_right = [("🎬","One-click demo — launch a live demo gym for any prospect"),
               ("📋","Full referral history — gym name, email, status, dates"),
               ("⚙️","Settings to update your profile & password")]

for i,(icon,text) in enumerate(tools_left):
    bullet(s5, icon, text, Inches(0.6), Inches(2.1)+i*Inches(0.88), Inches(5.8))
for i,(icon,text) in enumerate(tools_right):
    bullet(s5, icon, text, Inches(6.9), Inches(2.1)+i*Inches(0.88), Inches(6.0))

subtext(s5, "No commission on unpaid/refunded charges · Payments within 15 business days after month end",
        y=Inches(5.5), size=12, color=RGBColor(0x55,0x55,0x55))


# ─── SLIDE 6: ACCESS ──────────────────────────────────────────────────────────
s6 = add_slide()
tag(s6, "Access Guide")
heading(s6, "Where to go", size=34)

def access_card(slide, x, y, w, h, role, role_color, url, note):
    box(slide, x, y, w, h, fill=RGBColor(0x11,0x11,0x11),
        border=RGBColor(0x2a,0x2a,0x2a))
    txt(slide, role.upper(), x+Inches(0.25), y+Inches(0.2), w-Inches(0.5), Inches(0.3),
        size=9, bold=True, color=role_color)
    # URL pill
    ub = box(slide, x+Inches(0.2), y+Inches(0.58), w-Inches(0.4), Inches(0.45),
             fill=RGBColor(0x1a,0x15,0x00), border=RGBColor(0x44,0x38,0x00))
    txt(slide, url, x+Inches(0.35), y+Inches(0.65), w-Inches(0.6), Inches(0.35),
        size=12, bold=True, color=AMBER)
    txt(slide, note, x+Inches(0.25), y+Inches(1.18), w-Inches(0.5), Inches(1.0),
        size=12, color=GRAY)

AW = Inches(3.95); AH = Inches(2.8); AY = Inches(2.0)
access_card(s6, Inches(0.55), AY, AW, AH,
            "Sales Rep", PURPLE,
            "clubcheckapp.com/sales/login",
            "Your portal — referral link, QR code, funnel dashboard, demo launcher")
access_card(s6, Inches(4.69), AY, AW, AH,
            "Gym Owner", GREEN,
            "clubcheckapp.com/login",
            "What prospects see after signing up — full gym management dashboard")
access_card(s6, Inches(8.83), AY, AW, AH,
            "Admin (Internal)", AMBER,
            "clubcheckapp.com/admin",
            "Creates & manages sales rep accounts, views all reps & analytics")

subtext(s6, "Sales rep accounts are created by admin. You'll get credentials on onboarding and choose your commission option at that time (cannot be changed later).",
        y=Inches(5.1), size=12, color=RGBColor(0x55,0x55,0x55))


# ─── Save ─────────────────────────────────────────────────────────────────────
out = "/Users/mahadghazipura/clubcheck/decks/ClubCheck-Sales-Rep.pptx"
prs.save(out)
print(f"Saved: {out}")
