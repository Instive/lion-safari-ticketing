import Image from "next/image";
import Link from "next/link";

import { AnnouncementTicker } from "@/components/site/announcement-ticker";
import { FaqAccordion, type FaqItem } from "@/components/site/faq-accordion";
import { Reveal } from "@/components/site/reveal";
import { StatCounter } from "@/components/site/stat-counter";
import { env } from "@/lib/env";
import { formatPaiseCompact } from "@/lib/money";
import { businessDate, formatVisitDate } from "@/lib/time";

export const dynamic = "force-dynamic";

export default function HomePage() {
  // Every fare shown on this page comes from the same server-side figure the
  // booking form charges, so marketing copy can never drift from the price.
  const fare = formatPaiseCompact(env.TICKET_PRICE_PAISE);
  const today = formatVisitDate(businessDate());

  const notices = [
    `Online booking is open for today, ${today} — ${fare} per visitor.`,
    "Park timings: Tuesday to Sunday, 9:00 AM – 5:00 PM. Closed on Mondays.",
    "Last entry is one hour before closing.",
    "Cash tickets are also issued at the counter on arrival.",
    "Carry a valid photo ID — it may be checked at the boarding gate.",
  ];

  const faqs: FaqItem[] = [
    {
      question: "How much does a safari ticket cost?",
      answer:
        `${fare} per visitor for one safari ride through both the lion and deer habitats.` +
        (env.CONVENIENCE_FEE_PAISE > 0
          ? ` Online bookings also carry a convenience fee of ${formatPaiseCompact(
              env.CONVENIENCE_FEE_PAISE,
            )} per booking, shown in full before you pay.`
          : ""),
    },
    {
      question: "Do I need to print my ticket?",
      answer:
        "No. Show the QR code on your phone at the boarding gate — a printed copy works equally well if you prefer one.",
    },
    {
      question: "Can I pay by cash instead of booking online?",
      answer:
        "Yes. Buy your ticket with cash at the counter on arrival; counter staff issue the same QR ticket. No online account is needed either way.",
    },
    {
      question: "How do I find a ticket I have already booked?",
      answer:
        "Open Find My Ticket and enter your booking code together with the mobile number used at booking. The ticket opens again in your browser.",
    },
    {
      question: "Does everyone in my group need a separate ticket?",
      answer:
        "No. One booking covers your whole group and they board together — the visitor count is fixed at the time of booking, so please count everyone before you pay.",
    },
    {
      question: "When is the best time to visit?",
      answer:
        "Early morning or late afternoon, and the cooler months from October to March, when the animals are most active.",
    },
  ];

  return (
    <main>
      <AnnouncementTicker notices={notices} />

      {/* ---------- Hero ---------- */}
      <section className="relative flex min-h-[560px] w-full items-end overflow-hidden bg-zoo-forest-deep sm:h-[78svh] sm:max-h-[760px]">
        <div className="absolute inset-0">
          <Image
            src="/Wildlife_safari_web.png"
            alt="A lion resting in the forest at Chhatbir Zoo, with safari jeep and wildlife photos below"
            fill
            priority
            sizes="100vw"
            className="hero-pan object-cover object-[center_18%]"
          />
        </div>
        {/*
          Two scrims: one lifting the copy off the bottom of the photograph, and
          one down the left so the headline never has to compete with the
          typography printed into the artwork itself.
        */}
        <div className="absolute inset-0 bg-gradient-to-t from-zoo-forest-deep via-zoo-forest-deep/55 to-zoo-forest-deep/20" />
        <div className="absolute inset-0 bg-gradient-to-r from-zoo-forest-deep/90 via-zoo-forest-deep/45 to-transparent" />

        <div className="relative z-10 mx-auto w-full max-w-6xl px-4 pb-10 pt-24 sm:pb-14">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-zoo-gold-light sm:text-sm sm:tracking-[0.25em]">
            Mahendra Choudhury Zoological Park
          </p>
          <h1 className="mt-2 font-display text-5xl leading-[0.9] tracking-wide text-white sm:text-7xl">
            Lion &amp; Deer Safari
          </h1>
          <p className="mt-3 max-w-xl text-sm text-zoo-cream/90 sm:text-base">
            Ride through open enclosures at Chhatbir Zoo and see Asiatic lions, spotted deer and
            more in their natural habitat.
          </p>

          <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            <Link
              href="/book"
              className="touch-target grid place-items-center rounded-xl bg-zoo-gold-light px-7 text-base font-bold text-zoo-ink transition-all hover:brightness-95 hover:shadow-lg hover:shadow-black/40"
            >
              Book Your Tickets
            </Link>
            <Link
              href="/ticket"
              className="touch-target grid place-items-center rounded-xl border border-zoo-cream/40 bg-white/5 px-7 text-base font-semibold text-white backdrop-blur-sm transition-colors hover:bg-white/15"
            >
              Find My Ticket
            </Link>
          </div>

          {/* The official "fare board": today's entry, the fare and the hours. */}
          <dl className="mt-6 flex flex-col gap-2 text-sm text-zoo-cream/85 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-3">
            <div className="flex items-center gap-2 rounded-lg border border-zoo-cream/20 bg-zoo-forest-deep/50 px-3 py-2 backdrop-blur-sm">
              <TicketIcon />
              <dt className="sr-only">Entry and fare</dt>
              <dd>
                Entry today, {today} —{" "}
                <strong className="font-semibold text-zoo-gold-light">{fare}</strong> per visitor
              </dd>
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-zoo-cream/20 bg-zoo-forest-deep/50 px-3 py-2 backdrop-blur-sm">
              <ClockIcon />
              <dt className="sr-only">Timings</dt>
              <dd>9:00 AM – 5:00 PM · Closed Mondays</dd>
            </div>
          </dl>
        </div>
      </section>

      {/* ---------- Online services ---------- */}
      <section aria-labelledby="services-heading" className="border-b border-line bg-surface">
        <div className="mx-auto max-w-6xl px-4 py-10">
          <h2
            id="services-heading"
            className="text-center text-xs font-semibold uppercase tracking-[0.2em] text-accent"
          >
            Online Services
          </h2>
          <Reveal>
            <ul className="mt-5 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
              <ServiceTile href="/book" title="Book Tickets" note="Pay online, get a QR ticket">
                <TicketIcon size={22} />
              </ServiceTile>
              <ServiceTile href="/ticket" title="Find My Ticket" note="Booking code + mobile">
                <SearchIcon />
              </ServiceTile>
              <ServiceTile href="/visit" title="Plan Your Visit" note="Timings, rules, directions">
                <MapIcon />
              </ServiceTile>
              <ServiceTile href="/gallery" title="Gallery" note="Photos from the safari">
                <PhotoIcon />
              </ServiceTile>
            </ul>
          </Reveal>
        </div>
      </section>

      {/* ---------- At a glance ---------- */}
      <section aria-labelledby="glance-heading" className="border-b border-line bg-zoo-cream/50">
        <div className="mx-auto max-w-6xl px-4 py-10">
          <h2 id="glance-heading" className="sr-only">
            The park at a glance
          </h2>
          <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
            <StatCounter to={505} label="Acres of forest" />
            <StatCounter to={950} suffix="+" label="Animals" />
            <StatCounter to={85} suffix="+" label="Species" />
            <StatCounter to={17} suffix=" km" label="From Chandigarh" />
          </div>
        </div>
      </section>

      {/* ---------- Meet the wild ---------- */}
      <section className="mx-auto max-w-6xl px-4 py-14 sm:py-16">
        <Reveal>
          <div className="grid items-center gap-10 lg:grid-cols-2">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-accent">
                Meet the Wild
              </p>
              <h2 className="mt-2 font-display text-4xl tracking-wide text-brand sm:text-5xl">
                Two Safaris, One Journey
              </h2>
              <p className="text-muted mt-4">
                A single safari ride takes you through both habitats — no separate bookings, no
                extra stops.
              </p>

              <div className="mt-6 space-y-4">
                <FeatureRow
                  title="Lion Safari"
                  description="Watch Asiatic lions roam an open enclosure alongside barking deer, jackal and peafowl, from the safety of the safari vehicle."
                />
                <FeatureRow
                  title="Deer Safari"
                  description="Sambar, spotted deer, blackbuck and hog deer share one habitat — one of the largest deer safaris of its kind in the region."
                />
              </div>

              <Link
                href="/visit"
                className="group mt-6 inline-flex items-center gap-1.5 text-sm font-semibold text-brand underline underline-offset-4"
              >
                Read the full visitor guide
                <span className="transition-transform group-hover:translate-x-1" aria-hidden>
                  →
                </span>
              </Link>
            </div>

            <div className="relative aspect-square w-full overflow-hidden rounded-2xl border border-zoo-cream-strong bg-zoo-cream shadow-sm">
              <Image
                src="/lion_and_deer_safari_zoo.jpeg"
                alt="Lion and Deer Safari promotional poster showing the safari bus, a lion and a deer"
                fill
                sizes="(min-width: 1024px) 50vw, 100vw"
                className="object-contain p-2 transition-transform duration-500 hover:scale-[1.03]"
              />
            </div>
          </div>
        </Reveal>
      </section>

      {/* ---------- The experience ---------- */}
      <section className="bg-zoo-cream/60">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:py-16">
          <Reveal>
            <div className="grid items-center gap-10 lg:grid-cols-2">
              <div className="relative order-2 mx-auto aspect-[3/4] w-full max-w-sm overflow-hidden rounded-2xl border border-zoo-cream-strong bg-surface shadow-sm lg:order-1">
                <Image
                  src="/Wildlife_safari_chhatbir.jpeg"
                  alt="Story panels: entering the gate, meeting a lion, a spotted deer, and the safari jeep on the trail"
                  fill
                  sizes="(min-width: 1024px) 40vw, 100vw"
                  className="object-contain p-2"
                />
              </div>

              <div className="order-1 lg:order-2">
                <p className="text-sm font-semibold uppercase tracking-[0.2em] text-accent">
                  What to Expect
                </p>
                <h2 className="mt-2 font-display text-4xl tracking-wide text-brand sm:text-5xl">
                  From Gate to Grassland
                </h2>
                <ol className="text-muted mt-6 space-y-5">
                  <Step n={1} title="Arrive at the gate">
                    Show your QR ticket — on your phone or printed — at the boarding gate.
                  </Step>
                  <Step n={2} title="Board the safari vehicle">
                    Vehicles run through the safari route at regular intervals through the day.
                  </Step>
                  <Step n={3} title="Meet the king">
                    Pass slowly through the open lion enclosure, and stop for photos where
                    it&rsquo;s safe to.
                  </Step>
                  <Step n={4} title="Discover the deer habitat">
                    See several deer species sharing one open habitat before returning to the
                    main zoo.
                  </Step>
                </ol>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ---------- Plan your visit teaser ---------- */}
      <section aria-labelledby="plan-heading" className="mx-auto max-w-6xl px-4 py-14 sm:py-16">
        <h2
          id="plan-heading"
          className="font-display text-3xl tracking-wide text-brand sm:text-4xl"
        >
          Before You Come
        </h2>
        <Reveal>
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            <PlanCard title="Timings">
              Tuesday – Sunday, 9:00 AM – 5:00 PM.
              <br />
              Closed on Mondays.
            </PlanCard>
            <PlanCard title="Location">
              Chhat Village, Zirakpur–Patiala Highway, Punjab — about 17 km from Chandigarh.
            </PlanCard>
            <PlanCard title="Good to know">
              The whole group travels together on one ticket. Carry a valid photo ID for
              verification if asked.
            </PlanCard>
          </div>
        </Reveal>
        <div className="mt-6 text-center">
          <Link
            href="/visit"
            className="touch-target inline-grid place-items-center rounded-xl border border-brand px-6 text-sm font-semibold text-brand transition-colors hover:bg-brand hover:text-white"
          >
            Full Visitor Guide
          </Link>
        </div>
      </section>

      {/* ---------- FAQ ---------- */}
      <section aria-labelledby="faq-heading" className="border-y border-line bg-surface">
        <div className="mx-auto max-w-3xl px-4 py-14 sm:py-16">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-accent">
            Public Information
          </p>
          <h2
            id="faq-heading"
            className="mt-2 font-display text-3xl tracking-wide text-brand sm:text-4xl"
          >
            Frequently Asked Questions
          </h2>
          <div className="mt-6">
            <FaqAccordion items={faqs} />
          </div>
        </div>
      </section>

      {/* ---------- Final CTA ---------- */}
      <section className="bg-zoo-forest-deep">
        <div className="mx-auto max-w-3xl px-4 py-14 text-center sm:py-16">
          <h2 className="font-display text-4xl tracking-wide text-white sm:text-5xl">
            Ready to Enter the Wild?
          </h2>
          <p className="mt-3 text-zoo-cream/80">
            Book online in a minute at {fare} per visitor, or pay by cash at the counter on
            arrival.
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <Link
              href="/book"
              className="touch-target grid place-items-center rounded-xl bg-zoo-gold-light px-8 text-base font-bold text-zoo-ink transition-all hover:brightness-95 hover:shadow-lg hover:shadow-black/40"
            >
              Book Your Tickets
            </Link>
            <Link
              href="/ticket"
              className="touch-target grid place-items-center rounded-xl border border-zoo-cream/40 px-8 text-base font-semibold text-white transition-colors hover:bg-white/10"
            >
              Find My Ticket
            </Link>
          </div>
          {env.SUPPORT_PHONE ? (
            <p className="mt-6 text-sm text-zoo-cream/60">Need help? Call {env.SUPPORT_PHONE}</p>
          ) : null}
        </div>
      </section>
    </main>
  );
}

function ServiceTile({
  href,
  title,
  note,
  children,
}: {
  href: string;
  title: string;
  note: string;
  children: React.ReactNode;
}) {
  return (
    <li>
      <Link
        href={href}
        className="group flex h-full flex-col gap-2 rounded-xl border border-line bg-surface p-4 transition-all hover:-translate-y-0.5 hover:border-accent hover:shadow-md"
      >
        <span className="grid h-10 w-10 place-items-center rounded-lg bg-zoo-cream text-brand transition-colors group-hover:bg-brand group-hover:text-zoo-gold-light">
          {children}
        </span>
        <span className="font-semibold text-brand">{title}</span>
        <span className="text-muted text-xs">{note}</span>
      </Link>
    </li>
  );
}

function FeatureRow({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex gap-4 rounded-xl border border-line bg-surface p-4 transition-colors hover:border-accent">
      <span className="mt-0.5 text-2xl" aria-hidden>
        🐾
      </span>
      <div>
        <h3 className="font-semibold text-brand">{title}</h3>
        <p className="text-muted mt-1 text-sm">{description}</p>
      </div>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-4">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand font-display text-base text-white">
        {n}
      </span>
      <div>
        <p className="font-semibold text-foreground">{title}</p>
        <p className="text-muted text-sm">{children}</p>
      </div>
    </li>
  );
}

function PlanCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-5 transition-shadow hover:shadow-md">
      <h3 className="font-semibold text-brand">{title}</h3>
      <p className="text-muted mt-2 text-sm">{children}</p>
    </div>
  );
}

/* ---------- Icons ---------- */

function Icon({ size = 20, children }: { size?: number; children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="shrink-0"
    >
      {children}
    </svg>
  );
}

function TicketIcon({ size }: { size?: number } = {}) {
  return (
    <Icon size={size}>
      <path d="M3 9V7a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v2a2.5 2.5 0 0 0 0 5v3a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-3a2.5 2.5 0 0 0 0-5z" />
      <path d="M14 6v12" strokeDasharray="2 2.5" />
    </Icon>
  );
}

function ClockIcon() {
  return (
    <Icon>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 1.8" />
    </Icon>
  );
}

function SearchIcon() {
  return (
    <Icon size={22}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4.5 4.5" />
    </Icon>
  );
}

function MapIcon() {
  return (
    <Icon size={22}>
      <path d="M12 21s-6.5-5.2-6.5-10.5A6.5 6.5 0 0 1 12 4a6.5 6.5 0 0 1 6.5 6.5C18.5 15.8 12 21 12 21z" />
      <circle cx="12" cy="10.5" r="2.2" />
    </Icon>
  );
}

function PhotoIcon() {
  return (
    <Icon size={22}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="8.5" cy="10" r="1.5" />
      <path d="M4 17l5-4.5 4 3.5 2.5-2L20 17.5" />
    </Icon>
  );
}
