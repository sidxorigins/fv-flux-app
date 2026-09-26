import type { SessionPriority } from "@/generated/prisma/enums";

// Expogast 2026 — RAK Porcelain Culinary World Cup camera-team run sheet.
// Transcribed from Camera_Team_Expogast_2026.docx (Quick Hall Guide, Public
// Opening reference, Friday 20, Standard Competition Day, Thursday 26).
//
// This is a STARTING POINT: once imported, every day and session is editable
// in the app. Re-importing is refused while an event with this slug exists.

export interface TemplateSession {
  title: string;
  location?: string;
  focus?: string;
  /** "HH:MM" — when set, ordering follows the clock automatically. */
  startTime?: string;
  endTime?: string;
  /** Shown instead of a clock time: "Morning", "After ceremony". */
  timeLabel?: string;
  /** Minutes-since-midnight anchor for untimed sessions so they sort sensibly. */
  anchor?: number;
  priority: SessionPriority;
}

export interface TemplateDay {
  date: string; // YYYY-MM-DD
  title: string;
  notes?: string;
  sessions: TemplateSession[];
}

export interface EventTemplate {
  slug: string;
  name: string;
  subtitle: string;
  venue: string;
  timezone: string;
  startDate: string;
  endDate: string;
  days: TemplateDay[];
}

const HALL_GUIDE =
  "Hall 1 — Opening, Closing & Award ceremonies. " +
  "Hall 2 — Cold Exhibition + Live Carving. " +
  "Hall 3 — Restaurant des Nations + Senior/National Teams eatable buffet. " +
  "Hall 8 — Community Catering + Junior National Teams buffet + Food Truck & Street Food Contest.";

const PUBLIC_OPENING_STANDARD =
  "Public opening 11:00–21:00 (Halls 2/3/8/9). Community Catering Restaurant 11:30–14:00 (Hall 8). " +
  "Lounge Bar 17:00–20:00 (Hall 8, optional). Restaurant des Nations 17:30–21:30 (Hall 3).";

/** The Sat 21 – Wed 25 daily rhythm; the exact team/category per day follows the final draw. */
const STANDARD_DAY: TemplateSession[] = [
  {
    title: "Cold Exhibition – competitor access",
    location: "Hall 2",
    focus: "Early setup and behind-the-scenes preparation.",
    startTime: "05:00",
    priority: "OPTIONAL",
  },
  {
    title: "Cold Exhibition – final installation",
    location: "Hall 2",
    focus: "Finished exhibits being positioned before judging / public viewing.",
    startTime: "06:30",
    endTime: "07:00",
    priority: "MUST_FILM",
  },
  {
    title: "Individual cold competitions",
    location: "Hall 2",
    focus:
      "Culinary Art, Pastry Art, Culinary Artistic/Sculpture D1, Pastry Artistic D2, Salt & Spices and other cold-display categories.",
    timeLabel: "Morning",
    anchor: 8 * 60,
    priority: "HIGH",
  },
  {
    title: "Live Carving / Carving competitions",
    location: "Hall 2",
    focus: "Live action, technique, details, competitor concentration and finished pieces.",
    timeLabel: "During programme",
    anchor: 9 * 60,
    priority: "MUST_FILM",
  },
  {
    title: "Senior National Teams – camera ready",
    location: "Hall 3",
    focus: "Camera ready before Hot Kitchen activity.",
    startTime: "10:15",
    priority: "HIGH",
  },
  {
    title: "Senior National Team Hot Kitchen – teams enter",
    location: "Hall 3",
    focus: "Teams enter / kitchens available.",
    startTime: "10:30",
    priority: "MUST_FILM",
  },
  {
    title: "Senior National Teams – equipment introduction",
    location: "Hall 3",
    focus: "Equipment introduction / orientation; public halls open.",
    startTime: "11:00",
    priority: "HIGH",
  },
  {
    title: "Senior National Teams – mise en place & jury control",
    location: "Hall 3",
    focus: "Mise en place and jury control.",
    startTime: "11:30",
    priority: "MUST_FILM",
  },
  {
    title: "Community Catering",
    location: "Hall 8",
    focus: "Restaurant / competition lunch period; cooking, buffet/service, judging and guests.",
    startTime: "11:30",
    endTime: "14:00",
    priority: "MUST_FILM",
  },
  {
    title: "Junior National Teams / Young Chefs Eatable Buffet",
    location: "Hall 8",
    focus:
      "Preparation, buffet presentation, judging and service. IMPORTANT: this is separate from the Senior buffet in Hall 3.",
    timeLabel: "From late morning",
    anchor: 11 * 60 + 40,
    priority: "MUST_FILM",
  },
  {
    title: "Senior National Team Hot Kitchen – practical competition starts",
    location: "Hall 3",
    focus: "Practical competition starts.",
    startTime: "12:00",
    priority: "MUST_FILM",
  },
  {
    title: "Senior / National Teams Eatable Buffet",
    location: "Hall 3",
    focus: "Preparation and presentation of the Senior/National Team eatable buffet.",
    timeLabel: "Afternoon",
    anchor: 13 * 60,
    priority: "MUST_FILM",
  },
  {
    title: "Food Truck & Street Food Contest",
    location: "Hall 8",
    focus: "Action cooking, service and judging according to the final daily programme.",
    timeLabel: "Afternoon",
    anchor: 13 * 60 + 1,
    priority: "HIGH",
  },
  {
    title: "Regional Teams",
    location: "Hall 2",
    focus: "Competition coverage according to the final allocation / programme.",
    timeLabel: "Afternoon",
    anchor: 13 * 60 + 2,
    priority: "HIGH",
  },
  {
    title: "Cold Exhibition – jury feedback",
    location: "Hall 2",
    focus: "Judges and competitors discussing exhibits.",
    startTime: "14:00",
    endTime: "15:00",
    priority: "HIGH",
  },
  {
    title: "Daily results – camera position",
    location: "Hall 1",
    focus: "Be ready before the medal / diploma announcement.",
    startTime: "15:30",
    priority: "HIGH",
  },
  {
    title: "Daily cold-exhibit results",
    location: "Hall 1",
    focus: "Medal and diploma announcement.",
    startTime: "16:00",
    priority: "MUST_FILM",
  },
  {
    title: "Lounge Bar",
    location: "Hall 8",
    focus: "Atmosphere, sponsors, networking.",
    startTime: "17:00",
    endTime: "20:00",
    priority: "OPTIONAL",
  },
  {
    title: "Restaurant des Nations / Senior teams – final cooking",
    location: "Hall 3",
    focus: "Final cooking, finishing, plating, pass and guest-arrival atmosphere.",
    startTime: "17:00",
    endTime: "17:45",
    priority: "MUST_FILM",
  },
  {
    title: "Restaurant des Nations opens",
    location: "Hall 3",
    focus: "Restaurant opens; room and service atmosphere.",
    startTime: "17:30",
    priority: "HIGH",
  },
  {
    title: "Senior National Teams – evening service",
    location: "Hall 3",
    focus: "Final plates, jury plates, service and guest reactions.",
    startTime: "18:00",
    priority: "MUST_FILM",
  },
];

const AFTER_PARTY: TemplateSession = {
  title: "RAK Porcelain After Party",
  location: "Halls 2 / 3 / 8 / 9",
  focus: "Film teams, sponsors, networking, celebration and atmosphere.",
  startTime: "21:00",
  endTime: "01:00",
  priority: "MUST_FILM",
};

function standardDay(date: string, extra: TemplateSession[] = [], notes = PUBLIC_OPENING_STANDARD): TemplateDay {
  return {
    date,
    title: "Standard Competition Day",
    notes,
    sessions: [...STANDARD_DAY, ...extra],
  };
}

export const EXPOGAST_2026: EventTemplate = {
  slug: "expogast-2026",
  name: "Expogast 2026",
  subtitle: "RAK Porcelain Culinary World Cup 2026 — camera team",
  venue: "Luxexpo The Box, Luxembourg",
  timezone: "Europe/Luxembourg",
  startDate: "2026-11-20",
  endDate: "2026-11-26",
  days: [
    {
      date: "2026-11-20",
      title: "Opening Ceremony",
      notes: HALL_GUIDE,
      sessions: [
        {
          title: "EHTL team picture (~500 students & teachers)",
          location: "Hall 1",
          focus:
            "Major EHTL group picture. Camera team must be ready for a wide master shot, elevated / wide-angle coverage and several group variations.",
          timeLabel: "Time TBC",
          anchor: 0,
          priority: "MUST_FILM",
        },
        {
          title: "Team briefing",
          location: "Location TBC",
          focus: "Briefing before the start of the event. Team atmosphere, instructions and key organisational messages.",
          startTime: "13:00",
          priority: "HIGH",
        },
        {
          title: "Jury briefing",
          location: "Location TBC",
          focus: "Official jury briefing. Jury gathering, instructions and preparation before the Opening Ceremony.",
          startTime: "15:30",
          priority: "HIGH",
        },
        {
          title: "Camera setup",
          location: "Hall 1",
          focus: "Stage, branding, trophies, technical checks and establishing shots.",
          startTime: "16:00",
          endTime: "16:30",
          priority: "HIGH",
        },
        {
          title: "Restaurant set-up – final images",
          location: "Hall 3",
          focus:
            "Film the restaurants immediately after set-up, before guests / competition activity: clean wide shots, tables, branding, buffet and restaurant details, finished atmosphere.",
          timeLabel: "After restaurant set-up",
          anchor: 16 * 60 + 25,
          priority: "MUST_FILM",
        },
        {
          title: "Teams / officials assembling",
          location: "Hall 1",
          focus: "Uniforms, flags, jury, VIP arrivals, backstage atmosphere.",
          startTime: "16:30",
          endTime: "16:55",
          priority: "HIGH",
        },
        {
          title: "OPENING CEREMONY",
          location: "Hall 1",
          focus: "Official opening, team introductions, stage, audience reactions.",
          startTime: "17:00",
          priority: "MUST_FILM",
        },
        {
          title: "Post-ceremony",
          location: "Hall 1",
          focus: "Greetings, team reactions, networking, interviews if planned.",
          timeLabel: "After ceremony",
          anchor: 18 * 60,
          priority: "HIGH",
        },
      ],
    },
    standardDay(
      "2026-11-21",
      [AFTER_PARTY],
      "Public opening 11:00–01:00 including the After Party (Halls 2/3/8/9). Community Catering Restaurant 11:30–14:00 (Hall 8). Lounge Bar 17:00–20:00 (Hall 8, optional). Restaurant des Nations 17:30–21:30 (Hall 3).",
    ),
    standardDay("2026-11-22"),
    standardDay("2026-11-23"),
    standardDay("2026-11-24"),
    standardDay("2026-11-25"),
    {
      date: "2026-11-26",
      title: "Closing & Award Ceremony",
      sessions: [
        {
          title: "Hot Kitchen results",
          location: "Hall 1",
          focus: "Medal and diploma announcement.",
          startTime: "10:00",
          endTime: "12:00",
          priority: "MUST_FILM",
        },
        {
          title: "Camera setup",
          location: "Hall 1",
          focus: "Stage, trophies, branding, technical check.",
          startTime: "12:30",
          endTime: "13:00",
          priority: "HIGH",
        },
        {
          title: "Teams / jury / VIP arrivals",
          location: "Hall 1",
          focus: "Backstage, flags, anticipation and reactions.",
          startTime: "13:00",
          endTime: "13:40",
          priority: "HIGH",
        },
        {
          title: "Final camera positions",
          location: "Hall 1",
          focus: "Sound and shot check.",
          startTime: "13:40",
          priority: "HIGH",
        },
        {
          title: "CLOSING & AWARD CEREMONY",
          location: "Hall 1",
          focus: "Team winners, trophies, medals, flags, audience and emotional reactions.",
          startTime: "14:00",
          priority: "MUST_FILM",
        },
        {
          title: "Winner coverage",
          location: "Hall 1",
          focus: "Winner portraits, celebrations, trophy shots, interviews and organiser closing images.",
          timeLabel: "After ceremony",
          anchor: 15 * 60,
          priority: "MUST_FILM",
        },
      ],
    },
  ],
};

export const EVENT_TEMPLATES: Record<string, EventTemplate> = {
  [EXPOGAST_2026.slug]: EXPOGAST_2026,
};
