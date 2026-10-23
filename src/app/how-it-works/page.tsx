import type { Metadata } from 'next'
import Link from 'next/link'

// UmuBot -- methodology (essential-foods-redesign.md, Year 1: "Define the initial basket
// methodology and publish an explanation of its limitations"). Plain, static copy: it
// describes how the site works, not today's numbers, so it can't go stale with prices.

export const metadata: Metadata = {
  title: 'How it works · UmuBot',
  description: 'How UmuBot chooses its essential foods, collects prices, and where the data falls short.',
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-lg font-bold text-gray-800">{title}</h3>
      <div className="space-y-2 text-sm text-gray-600 leading-relaxed">{children}</div>
    </section>
  )
}

export default function HowItWorksPage() {
  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-gray-800 mb-1">How it works</h2>
        <p className="text-sm text-gray-500">
          What UmuBot shows, where the prices come from, and what they can&apos;t tell you.
        </p>
      </div>

      <Section title="The essential foods">
        <p>
          UmuBot tracks a fixed list of everyday foods in two groups. <strong>Pantry Essentials</strong>{' '}are
          shelf-stable foods you can buy in bulk and store — rice, pasta, flour, canned fish and vegetables,
          oils, dried legumes. <strong>Nutrition Essentials</strong>{' '}are fresh foods you buy as needed — vegetables,
          fruit, meat and fish, eggs, dairy, bread.
        </p>
        <p>
          The list follows public guidance on a healthy, affordable diet (the World Health Organization, the
          UN Food and Agriculture Organization&apos;s cost-of-a-healthy-diet work, and New Zealand&apos;s eating
          guidelines). A food is grouped by the form it&apos;s sold in, not its name: fresh milk is Nutrition,
          long-life milk is Pantry. New foods are only shown once their prices have been checked by hand.
        </p>
      </Section>

      <Section title="Where the prices come from">
        <p>
          New Zealand prices are scanned from <strong>New World and PAK&apos;nSAVE</strong>{' '}supermarkets each night.
          Each price is tied to a real store and the day it was seen. Some foods are checked every night, newer
          ones every few nights.
        </p>
        <p>
          Outside New Zealand, prices come from crowd-reported shop prices where they exist, then published
          national price estimates, and otherwise an AI web search of local retailers. Anything not scanned in a
          store is labelled <span className="text-amber-600 font-medium">Estimated</span>.
        </p>
      </Section>

      <Section title="Which product is shown for each food">
        <p>
          A food like &quot;Beef steak&quot; matches many products. UmuBot shows the <strong>everyday version</strong>:
          it sets aside processed or packaged forms (sausages, kebabs, fries, slices, microwave packs, gluten-free
          versions), then picks the plain product that most stores sell — with an AI check that the product
          really is that food. The same product is used everywhere, so prices are comparable from place to place.
        </p>
        <p>
          With your location, you see the <strong>nearest store within 50 km</strong>{' '}that sells that product,
          and a cheaper store nearby when there is one. Without it, you see the cheapest store in New Zealand.
        </p>
      </Section>

      <Section title="Freshness labels">
        <p>
          Every price says how fresh it is: <span className="text-green-700 font-medium">Live</span>{' '}— scanned in
          the last 7 days; <span className="text-sky-700 font-medium">Recent</span>{' '}— scanned 8 to 30 days ago;{' '}
          <span className="text-amber-600 font-medium">Estimated</span>{' '}— not scanned (an AI search or a reported
          price). Prices older than 30 days aren&apos;t shown at all.
        </p>
      </Section>

      <Section title="Unit price, cost per serving and storage life">
        <p>
          <strong>Unit price</strong>{' '}(per kg, per litre or each) comes from the supermarket&apos;s own figure, or from
          the pack size when it doesn&apos;t give one.
        </p>
        <p>
          <strong>Cost per serving</strong>{' '}is the unit price times a practical household portion — for example 75 g
          of dry rice, two eggs, or 150 g of raw meat. These are everyday portions, not official dietary
          servings, and the cost moves with the price.
        </p>
        <p>
          <strong>Storage life</strong>{' '}is a typical figure for an <em>unopened</em>{' '}product kept as recommended. It is a
          guide only — the date on the pack always wins.
        </p>
      </Section>

      <Section title="Nutrition">
        <p>
          Each food shows energy, protein and fibre for one serving of the edible part — a whole snapper
          serving is about 130 g of fish, and two eggs about 100 g. The values come from the US
          Department of Agriculture&apos;s{' '}<strong>FoodData Central</strong>, using one hand-picked, unfortified
          entry per food.
        </p>
        <p>
          Labels such as{' '}<em>source of iron</em>{' '}or{' '}<em>good source of protein</em>{' '}use the same thresholds as food
          packaging in New Zealand: the Australia New Zealand Food Standards Code (Schedule 4). For
          example, a source of protein has at least 5 g per serving, and a source of a vitamin or mineral
          has at least 10% of its recommended dietary intake. For omega-3 we check saturated fat only,
          because the data has no trans-fat figures.
        </p>
        <p>
          US foods aren&apos;t identical to New Zealand ones. Where that matters we say so — US white bread
          has added iron and calcium, so we don&apos;t claim them for NZ bread, which instead must be made
          with iodised salt. The US data has no iodine figures at all, so no food is labelled a source
          of iodine. This is general information about foods, not dietary or medical advice.
        </p>
      </Section>

      <Section title="What the data can't tell you">
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <strong>Not every supermarket is covered.</strong>{' '}Prices come from New World and PAK&apos;nSAVE only —
            Woolworths (Countdown) and independent shops aren&apos;t included, so a cheaper price may exist elsewhere.
          </li>
          <li>
            <strong>Not every store, every night.</strong>{' '}A food can show &quot;not sold nearby&quot; when no nearby store&apos;s
            price has been collected recently, even if the shop stocks it.
          </li>
          <li><strong>Some foods have no price yet</strong>{' '}and stay hidden until they do.</li>
          <li>
            <strong>Prices are as each store lists them.</strong>{' '}In-store specials and member prices may differ.
          </li>
          <li>
            <strong>Estimated prices are approximate</strong>{' '}— use them to compare, not to budget to the cent.
          </li>
          <li>
            <strong>This isn&apos;t dietary or food-safety advice.</strong>{' '}Servings and storage times are general guides.
          </li>
        </ul>
      </Section>

      <p className="text-xs text-gray-400">
        Questions or a price that looks wrong? The list and the way products are chosen are reviewed as the
        data grows. <Link href="/" className="text-green-700 hover:underline">Back to Essential</Link>
      </p>
    </div>
  )
}
