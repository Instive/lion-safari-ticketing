import Link from "next/link";

export const metadata = {
  title: "Plan Your Visit — Chhatbir Zoo",
  description: "Timings, entry information, rules and directions for the Lion & Deer Safari at Chhatbir Zoo.",
};

export default function VisitPage() {
  return (
    <main className="mx-auto max-w-4xl px-4 py-12">
      <header className="mb-10 text-center">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-accent">Visitor Guide</p>
        <h1 className="mt-2 font-display text-5xl tracking-wide text-brand">Plan Your Visit</h1>
        <p className="text-muted mx-auto mt-3 max-w-lg">
          Everything you need to know before you come see the lions and deer at Mahendra
          Choudhury Zoological Park, Chhatbir.
        </p>
      </header>

      <Section id="timings" title="Timings">
        <dl className="grid gap-3 sm:grid-cols-2">
          <InfoRow label="Open">Tuesday – Sunday, 9:00 AM – 5:00 PM</InfoRow>
          <InfoRow label="Closed">Every Monday</InfoRow>
          <InfoRow label="Last entry">One hour before closing</InfoRow>
          <InfoRow label="Best time to visit">
            Early morning or late afternoon, and the cooler months (Oct – Mar), for the most
            active wildlife sightings
          </InfoRow>
        </dl>
      </Section>

      <Section title="Tickets">
        <p className="text-muted">
          Every ticket — booked online or bought with cash at the counter — covers one safari
          ride through both the lion and deer habitats for your whole group.
        </p>
        <ul className="text-muted mt-4 list-disc space-y-2 pl-5">
          <li>Book online in advance and show the QR code on your phone at the gate.</li>
          <li>Or pay cash at the counter on arrival — no online account needed either way.</li>
          <li>Your whole group boards together on one ticket; the visitor count is fixed at booking.</li>
          <li>Lost your ticket? Look it up again with your booking code and phone number.</li>
        </ul>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href="/book"
            className="touch-target grid place-items-center rounded-xl bg-brand px-6 text-sm font-semibold text-white hover:bg-brand-strong"
          >
            Book Tickets
          </Link>
          <Link
            href="/ticket"
            className="touch-target grid place-items-center rounded-xl border border-brand px-6 text-sm font-semibold text-brand hover:bg-brand hover:text-white"
          >
            Find My Ticket
          </Link>
        </div>
      </Section>

      <Section id="reach" title="How to Reach">
        <p className="text-muted">
          Chhat Village, Zirakpur–Patiala Highway (NH-7), Punjab — about 17 km from Chandigarh
          and close to Zirakpur.
        </p>
        <ul className="text-muted mt-4 list-disc space-y-2 pl-5">
          <li>By road: on the Chandigarh–Patiala highway, a short drive past Zirakpur.</li>
          <li>Nearest railway station: Chandigarh Railway Station.</li>
          <li>Nearest airport: Chandigarh International Airport.</li>
          <li>Parking is available on site.</li>
        </ul>
      </Section>

      <Section id="rules" title="Rules & Guidelines">
        <ul className="text-muted grid gap-2 sm:grid-cols-2">
          {RULES.map((rule) => (
            <li key={rule} className="flex gap-2 rounded-lg border border-line bg-surface p-3 text-sm">
              <span aria-hidden>🐾</span>
              {rule}
            </li>
          ))}
        </ul>
      </Section>

      <Section id="faq" title="Frequently Asked">
        {FAQS.map((faq) => (
          <details key={faq.q} className="group rounded-lg border border-line bg-surface p-4">
            <summary className="cursor-pointer font-medium text-foreground">{faq.q}</summary>
            <p className="text-muted mt-2 text-sm">{faq.a}</p>
          </details>
        ))}
      </Section>
    </main>
  );
}

const RULES = [
  "Stay seated inside the safari vehicle at all times — do not lean or reach out.",
  "Do not feed, tease or make loud noises at the animals.",
  "Flash photography is not permitted near the enclosures.",
  "Follow the instructions of safari and gate staff at all times.",
  "No plastic bags, smoking or alcohol inside the park.",
  "Children must be accompanied by an adult throughout the visit.",
];

const FAQS = [
  {
    q: "Can I book for the same day?",
    a: "Yes — online bookings are accepted for same-day visits, subject to the day's timings.",
  },
  {
    q: "Do I need to print my ticket?",
    a: "No. Show the QR code on your phone at the gate, or bring a printout — either works.",
  },
  {
    q: "What if part of my group boards separately?",
    a: "The whole group listed on a ticket boards together in one go — that's how the ticket is validated at the gate.",
  },
  {
    q: "Is there a counter to buy tickets on arrival?",
    a: "Yes, cash tickets are available at the counter for walk-in visitors.",
  },
];

function Section({
  id,
  title,
  children,
}: {
  id?: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="mb-12 scroll-mt-24">
      <h2 className="font-display text-2xl tracking-wide text-brand">{title}</h2>
      <div className="mt-4 space-y-3">{children}</div>
    </section>
  );
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-3">
      <dt className="text-muted text-xs uppercase tracking-wide">{label}</dt>
      <dd className="mt-1 font-medium">{children}</dd>
    </div>
  );
}
