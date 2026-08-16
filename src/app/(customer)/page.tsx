import Image from "next/image";
import Link from "next/link";

import { env } from "@/lib/env";
import { formatPaise } from "@/lib/money";
import { businessDate, formatVisitDate } from "@/lib/time";

export const dynamic = "force-dynamic";

export default function HomePage() {
  return (
    <>
      {/* ---------- Hero ---------- */}
      <section className="relative h-[78vh] min-h-[520px] w-full overflow-hidden bg-zoo-forest-deep">
        <Image
          src="/Wildlife_safari_web.png"
          alt="A lion resting in the forest at Chhatbir Zoo, with safari jeep and wildlife photos below"
          fill
          priority
          className="object-cover object-[center_18%]"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-zoo-forest-deep via-zoo-forest-deep/30 to-transparent" />

        <div className="relative z-10 mx-auto flex h-full max-w-6xl flex-col justify-end px-4 pb-12">
          <p className="text-sm font-medium uppercase tracking-[0.25em] text-zoo-gold-light">
            Mahendra Choudhury Zoological Park
          </p>
          <h1 className="mt-2 font-display text-6xl leading-[0.9] tracking-wide text-white sm:text-7xl">
            Lion &amp; Deer Safari
          </h1>
          <p className="mt-3 max-w-xl text-zoo-cream/90">
            Ride through open enclosures at Chhatbir Zoo and see Asiatic lions, spotted deer and
            more in their natural habitat.
          </p>

          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Link
              href="/book"
              className="touch-target grid place-items-center rounded-xl bg-zoo-gold-light px-7 text-base font-bold text-zoo-ink transition-colors hover:brightness-95"
            >
              Book Your Tickets
            </Link>
            <Link
              href="/ticket"
              className="touch-target grid place-items-center rounded-xl border border-zoo-cream/40 px-7 text-base font-semibold text-white transition-colors hover:bg-white/10"
            >
              Find My Ticket
            </Link>
          </div>

          <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm text-zoo-cream/80">
            <span>
              Entry today, {formatVisitDate(businessDate())} —{" "}
              <strong className="text-zoo-gold-light">{formatPaise(env.TICKET_PRICE_PAISE)}</strong>{" "}
              per visitor
            </span>
            <span>9:00 AM – 5:00 PM · Closed Mondays</span>
          </div>
        </div>
      </section>

      {/* ---------- Quick info strip ---------- */}
      <section className="border-b border-line bg-surface">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-4 px-4 py-6 sm:grid-cols-4">
          <InfoStat value="505" label="Acres of forest" />
          <InfoStat value="950+" label="Animals" />
          <InfoStat value="85+" label="Species" />
          <InfoStat value="17 km" label="From Chandigarh" />
        </div>
      </section>

      {/* ---------- Meet the wild ---------- */}
      <section className="mx-auto max-w-6xl px-4 py-16">
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
              className="mt-6 inline-block text-sm font-semibold text-brand underline underline-offset-4"
            >
              Read the full visitor guide →
            </Link>
          </div>

          <div className="relative aspect-square w-full overflow-hidden rounded-2xl border border-zoo-cream-strong bg-zoo-cream shadow-sm">
            <Image
              src="/lion_and_deer_safari_zoo.jpeg"
              alt="Lion and Deer Safari promotional poster showing the safari bus, a lion and a deer"
              fill
              className="object-contain p-2"
            />
          </div>
        </div>
      </section>

      {/* ---------- The experience ---------- */}
      <section className="bg-zoo-cream/60">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-16 lg:grid-cols-2">
          <div className="relative order-2 mx-auto aspect-[3/4] w-full max-w-sm overflow-hidden rounded-2xl border border-zoo-cream-strong bg-surface shadow-sm lg:order-1">
            <Image
              src="/Wildlife_safari_chhatbir.jpeg"
              alt="Story panels: entering the gate, meeting a lion, a spotted deer, and the safari jeep on the trail"
              fill
              className="object-contain p-2"
            />
          </div>

          <div className="order-1 lg:order-2">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-accent">
              What to Expect
            </p>
            <h2 className="mt-2 font-display text-4xl tracking-wide text-brand sm:text-5xl">
              Ready to Enter the Wild?
            </h2>
            <ol className="text-muted mt-6 space-y-5">
              <Step n={1} title="Arrive at the gate">
                Show your QR ticket — on your phone or printed — at the boarding gate.
              </Step>
              <Step n={2} title="Board the safari vehicle">
                Vehicles run through the safari route at regular intervals through the day.
              </Step>
              <Step n={3} title="Meet the king">
                Pass slowly through the open lion enclosure, and stop for photos where it&rsquo;s
                safe to.
              </Step>
              <Step n={4} title="Discover the deer habitat">
                See several deer species sharing one open habitat before returning to the main
                zoo.
              </Step>
            </ol>
          </div>
        </div>
      </section>

      {/* ---------- Plan your visit teaser ---------- */}
      <section className="mx-auto max-w-6xl px-4 py-16">
        <div className="grid gap-4 sm:grid-cols-3">
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
        <div className="mt-6 text-center">
          <Link
            href="/visit"
            className="touch-target inline-grid place-items-center rounded-xl border border-brand px-6 text-sm font-semibold text-brand hover:bg-brand hover:text-white"
          >
            Full Visitor Guide
          </Link>
        </div>
      </section>

      {/* ---------- Final CTA ---------- */}
      <section className="bg-zoo-forest-deep">
        <div className="mx-auto max-w-3xl px-4 py-16 text-center">
          <h2 className="font-display text-4xl tracking-wide text-white sm:text-5xl">
            Ready to Enter the Wild?
          </h2>
          <p className="mt-3 text-zoo-cream/80">
            Book online in a minute, or pay by cash at the counter on arrival.
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <Link
              href="/book"
              className="touch-target grid place-items-center rounded-xl bg-zoo-gold-light px-8 text-base font-bold text-zoo-ink hover:brightness-95"
            >
              Book Your Tickets
            </Link>
          </div>
          {env.SUPPORT_PHONE ? (
            <p className="mt-6 text-sm text-zoo-cream/60">Need help? Call {env.SUPPORT_PHONE}</p>
          ) : null}
        </div>
      </section>
    </>
  );
}

function InfoStat({ value, label }: { value: string; label: string }) {
  return (
    <div className="text-center">
      <p className="font-display text-3xl tracking-wide text-brand">{value}</p>
      <p className="text-muted text-xs uppercase tracking-wide">{label}</p>
    </div>
  );
}

function FeatureRow({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex gap-4 rounded-xl border border-line bg-surface p-4">
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
    <div className="rounded-xl border border-line bg-surface p-5">
      <h3 className="font-semibold text-brand">{title}</h3>
      <p className="text-muted mt-2 text-sm">{children}</p>
    </div>
  );
}
