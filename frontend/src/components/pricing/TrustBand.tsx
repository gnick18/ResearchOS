"use client";

import { Icon } from "@/components/icons";

/**
 * The pricing "trust band". Replaces the three flat FeatureGrid sections
 * (metering, labs, guardrails) with one designed band that shows the mechanism
 * instead of listing cards: a struck-through meter, a one-invoice lab pool, a
 * budget circuit breaker, and a cost-vs-surplus bar. Three numbered movements
 * with a closer, built from the approved mockup
 * (docs/mockups/2026-06-12-pricing-trust-band-redesign.html).
 *
 * Light-only (the pricing page is a light marketing surface). Scoped styled-jsx
 * carries the bento + mechanic CSS; the only icon is the verified <Icon name>
 * checkmark (no inline SVG, so the icon guard stays happy). All motion is gated
 * on prefers-reduced-motion.
 *
 * Voice: no em-dashes, no emojis, no mid-sentence colons.
 */
export default function TrustBand() {
  return (
    <div className="trustband mx-auto max-w-[1180px] px-2 sm:px-6">
      <p className="tb-eyebrow">// billing you can trust, by design</p>
      <h2 className="tb-h2">Pricing that can&apos;t surprise you</h2>
      <p className="tb-sub">
        Three promises, each enforced by how the product actually works, not by a
        sentence on a page.
      </p>

      <div className="band">
        {/* 01 never metered */}
        <div className="band-top">
          <div className="numbadge">
            <span className="n">01</span>
            <span className="lbl">never metered</span>
          </div>
          <h3 className="band-h">Your editing is never metered</h3>
          <p className="band-s">
            No per-keystroke charge, no per-sync fee. The opposite of
            nickel-and-diming, on purpose.
          </p>
        </div>
        <div className="bento">
          <div className="tile hero span4">
            <span className="tag">what you type</span>
            <h4>Editing is included, not billed</h4>
            <p>
              Editing and collaboration come with your plan. No second meter on
              your keystrokes, no per-edit line on your invoice.
            </p>
            <div className="mech">
              <span className="keys">cgtacc&hellip;</span>
              <span className="arrow">&rarr;</span>
              <span className="save">
                <Icon name="check" className="h-[15px] w-[15px]" /> saved, $0
              </span>
              <span className="meter-x">
                <span className="gauge">
                  <i />
                  <span className="strike" />
                </span>
                no meter
              </span>
            </div>
          </div>
          <div className="tile span2">
            <span className="tag">heavy month</span>
            <h4>A throttle, never a bill</h4>
            <p>
              Past your allowance, live sync slows to periodic. Work keeps
              saving. The PI can raise the plan. No shock charge.
            </p>
          </div>
        </div>

        {/* 02 one lab, one invoice */}
        <div className="band-top div">
          <div className="numbadge">
            <span className="n">02</span>
            <span className="lbl">one lab, one invoice</span>
          </div>
          <h3 className="band-h">Built for a whole lab, billed to one person</h3>
        </div>
        <div className="bento">
          <div className="tile hero span6">
            <span className="tag">the structure</span>
            <h4>One shared pool, one invoice</h4>
            <p>
              Free or paid, the lab shares one pool. Only the PI pays, on one
              invoice. Members never get billed and never enter a card.
            </p>
            <div className="pool">
              <span className="spark" />
              <span className="pi-node">PI pays once</span>
              <span className="arrow">&rarr;</span>
              <span className="invoice">1 invoice &middot; shared pool</span>
              <span className="arrow">&rarr;</span>
              <span className="members">
                <span className="mem">A</span>
                <span className="mem">M</span>
                <span className="mem">W</span>
                <span className="mem">+</span>
              </span>
              <span className="free">members use it, $0</span>
            </div>
          </div>
          <div className="tile span2">
            <span className="tag">join</span>
            <h4>Invite by email</h4>
            <p>
              The PI invites, the member accepts before the lab covers them. We
              don&apos;t store the address.
            </p>
          </div>
          <div className="tile span2">
            <span className="tag">manage</span>
            <h4>The PI sees the pool</h4>
            <p>
              Because the PI pays, they can see each member&apos;s storage and
              activity to manage it. Members are told on accept.
            </p>
          </div>
          <div className="tile span2">
            <span className="tag">always</span>
            <h4>Local-first for all</h4>
            <p>
              Every member keeps their own data in their own folder. The plan
              funds the synced copies, not the local work.
            </p>
          </div>
        </div>

        {/* 03 the guarantee */}
        <div className="band-top div">
          <div className="numbadge">
            <span className="n">03</span>
            <span className="lbl">the guarantee</span>
          </div>
          <h3 className="band-h">We cannot run up a bill and hand it to you</h3>
        </div>
        <div className="bento">
          <div className="tile span3">
            <span className="tag">guardrail one</span>
            <h4>A cost circuit breaker</h4>
            <p>
              A hard monthly budget. If cloud spend nears it, cloud writes pause
              and the local-first app keeps working, uninterrupted.
            </p>
            <div className="breaker">
              <div className="budget">
                <i />
                <span className="cap" />
              </div>
              <div className="brow">
                <span className="pause">cloud writes pause at the cap</span>
                <span className="local">local app keeps working</span>
              </div>
            </div>
          </div>
          <div className="tile span3">
            <span className="tag">guardrail two</span>
            <h4>Priced to sustain, not to profit</h4>
            <p>
              You and your lab pay what storage costs us, no more. Institutions
              pay a small sustaining rate above cost, and that surplus keeps
              ResearchOS free for individual researchers.
            </p>
            <div className="costbar">
              <div className="cbrow">
                <span className="lab">you / lab</span>
                <span className="track">
                  <span className="cost" style={{ width: "100%" }} />
                </span>
                <span className="cnote">at cost</span>
              </div>
              <div className="cbrow">
                <span className="lab">institution</span>
                <span className="track">
                  <span className="cost" style={{ width: "70%" }} />
                  <span className="surplus" style={{ left: "70%", width: "30%" }} />
                </span>
                <span className="cnote purple">+ funds free tiers</span>
              </div>
            </div>
          </div>
        </div>

        <div className="closer">
          <p className="big">
            We literally cannot run up a bill and hand it to you.
          </p>
          <p className="en">// it is enforced in code, not just promised in copy</p>
        </div>
      </div>

      <style jsx>{`
        .trustband {
          --ink: #0f2350;
          --muted: #516079;
          --line: #dbe6f3;
          --tile: #fbfcfe;
          --card: #fff;
          --action: #1283c9;
          --purple: #5b47d6;
          --green: #16a34a;
          --amber: #f59e0b;
        }
        .tb-eyebrow {
          font-family: ui-monospace, Menlo, monospace;
          font-size: 12px;
          font-weight: 700;
          color: var(--action);
          letter-spacing: 0.04em;
          text-align: center;
          margin: 0;
        }
        .tb-h2 {
          font-size: clamp(20px, 6vw, 30px);
          font-weight: 800;
          letter-spacing: -0.02em;
          text-align: center;
          margin: 8px auto 6px;
          max-width: 22ch;
          line-height: 1.12;
          color: var(--ink);
        }
        .tb-sub {
          font-size: 15px;
          color: var(--muted);
          text-align: center;
          max-width: 58ch;
          margin: 0 auto 26px;
          line-height: 1.6;
        }
        .band {
          border: 1px solid var(--line);
          border-radius: 26px;
          overflow: hidden;
          background: var(--card);
          box-shadow: 0 30px 60px -40px rgba(15, 40, 80, 0.4);
        }
        .band-top {
          padding: clamp(16px, 5vw, 34px) clamp(14px, 5vw, 30px) 8px;
          text-align: center;
          background: radial-gradient(
            120% 120% at 50% -10%,
            rgba(18, 131, 201, 0.06),
            transparent
          );
        }
        .band-top.div {
          border-top: 1px solid var(--line);
          margin-top: 8px;
          padding-top: 18px;
        }
        .numbadge {
          display: inline-flex;
          align-items: center;
          gap: 9px;
          margin-bottom: 2px;
        }
        .numbadge .n {
          display: grid;
          place-items: center;
          width: 26px;
          height: 26px;
          border-radius: 50%;
          background: linear-gradient(135deg, var(--action), var(--purple));
          color: #fff;
          font-size: 12px;
          font-weight: 800;
          box-shadow: 0 4px 12px -3px rgba(18, 131, 201, 0.6);
        }
        .numbadge .lbl {
          font-family: ui-monospace, monospace;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: var(--muted);
        }
        .band-h {
          font-size: clamp(18px, 5vw, 26px);
          font-weight: 800;
          letter-spacing: -0.02em;
          margin: 6px auto 0;
          max-width: 24ch;
          line-height: 1.12;
          color: var(--ink);
        }
        .band-s {
          font-size: 15px;
          color: var(--muted);
          max-width: 56ch;
          margin: 8px auto 0;
          line-height: 1.6;
        }
        .bento {
          display: grid;
          grid-template-columns: repeat(6, 1fr);
          gap: 14px;
          padding: 18px 24px 30px;
        }
        @media (max-width: 760px) {
          .bento {
            grid-template-columns: repeat(2, 1fr);
          }
        }
        @media (max-width: 480px) {
          .bento {
            grid-template-columns: 1fr;
            padding: 12px 12px 20px;
            gap: 10px;
          }
        }
        .tile {
          border: 1px solid var(--line);
          border-radius: 18px;
          padding: 20px;
          background: var(--tile);
          position: relative;
          overflow: hidden;
        }
        .span6 {
          grid-column: span 6;
        }
        .span4 {
          grid-column: span 4;
        }
        .span3 {
          grid-column: span 3;
        }
        .span2 {
          grid-column: span 2;
        }
        @media (max-width: 760px) {
          .span6,
          .span4,
          .span3,
          .span2 {
            grid-column: span 2;
          }
        }
        @media (max-width: 480px) {
          .span6,
          .span4,
          .span3,
          .span2 {
            grid-column: span 1;
          }
        }
        .tile.hero {
          background: linear-gradient(
            135deg,
            rgba(18, 131, 201, 0.055),
            rgba(91, 71, 214, 0.055)
          );
          border-color: rgba(18, 131, 201, 0.2);
        }
        .tag {
          font-family: ui-monospace, monospace;
          font-size: 11px;
          font-weight: 700;
          color: var(--action);
        }
        .tile h4 {
          font-size: 16px;
          font-weight: 800;
          margin: 8px 0 6px;
          letter-spacing: -0.01em;
          color: var(--ink);
        }
        .tile.span6 h4 {
          font-size: 22px;
        }
        .tile p {
          font-size: 13px;
          color: var(--muted);
          line-height: 1.55;
          margin: 0;
        }
        .mech {
          display: flex;
          align-items: center;
          gap: 14px;
          margin-top: 14px;
          flex-wrap: wrap;
        }
        .keys {
          font-family: ui-monospace, monospace;
          font-size: 12px;
          color: var(--ink);
          background: var(--card);
          border: 1px solid var(--line);
          border-radius: 8px;
          padding: 7px 10px;
        }
        .arrow {
          color: var(--muted);
          font-weight: 900;
        }
        .save {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          color: var(--green);
          font-size: 12px;
          font-weight: 800;
          animation: tb-pop 0.5s 0.55s both;
        }
        .meter-x {
          position: relative;
          display: inline-flex;
          align-items: center;
          gap: 7px;
          color: var(--muted);
          font-size: 12px;
          font-weight: 700;
        }
        .meter-x .gauge {
          width: 46px;
          height: 9px;
          border-radius: 99px;
          background: var(--line);
          overflow: hidden;
          position: relative;
        }
        .meter-x .gauge i {
          display: block;
          height: 100%;
          width: 100%;
          background: repeating-linear-gradient(
            90deg,
            #cbd5e1,
            #cbd5e1 4px,
            transparent 4px,
            transparent 8px
          );
          background-size: 16px 9px;
          animation: tb-dash 1s linear infinite;
        }
        .meter-x .strike {
          position: absolute;
          left: -4px;
          right: -4px;
          top: 50%;
          height: 2px;
          background: #dc2626;
          transform: rotate(-8deg);
        }
        .pool {
          display: flex;
          align-items: center;
          justify-content: flex-start;
          gap: 8px;
          margin-top: 12px;
          flex-wrap: wrap;
          position: relative;
        }
        @media (max-width: 480px) {
          .pool {
            flex-direction: column;
            align-items: flex-start;
          }
          .pool .arrow {
            display: none;
          }
          .pool .spark {
            display: none;
          }
        }
        .pool .spark {
          position: absolute;
          top: 50%;
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: var(--action);
          box-shadow: 0 0 10px 2px rgba(18, 131, 201, 0.67);
          transform: translateY(-50%);
          animation: tb-flow 2.8s ease-in-out infinite;
        }
        .pi-node {
          background: linear-gradient(
            90deg,
            rgba(59, 139, 255, 0.13),
            rgba(160, 107, 255, 0.13)
          );
          border: 1px solid rgba(59, 139, 255, 0.33);
          border-radius: 12px;
          padding: 10px 13px;
          font-size: 12.5px;
          font-weight: 800;
          color: var(--ink);
        }
        .invoice {
          border: 1px dashed var(--action);
          border-radius: 10px;
          padding: 8px 11px;
          font-size: 11.5px;
          font-weight: 800;
          color: var(--action);
        }
        .members {
          display: flex;
          gap: 6px;
        }
        .mem {
          width: 30px;
          height: 30px;
          border-radius: 8px;
          background: var(--card);
          border: 1px solid var(--line);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 11px;
          font-weight: 800;
          color: var(--muted);
        }
        .free {
          font-size: 11.5px;
          font-weight: 800;
          color: var(--green);
        }
        .breaker {
          margin-top: 12px;
        }
        .budget {
          height: 11px;
          border-radius: 99px;
          background: var(--line);
          overflow: hidden;
          position: relative;
        }
        .budget i {
          display: block;
          height: 100%;
          width: 88%;
          background: linear-gradient(90deg, var(--green), var(--amber));
          transform-origin: left center;
          animation: tb-grow 0.9s cubic-bezier(0.4, 0, 0.2, 1) both;
        }
        .budget .cap {
          position: absolute;
          right: 8%;
          top: -3px;
          bottom: -3px;
          width: 2px;
          background: var(--ink);
        }
        .breaker .brow {
          display: flex;
          justify-content: space-between;
          margin-top: 8px;
          font-size: 11.5px;
          font-weight: 700;
        }
        .breaker .pause {
          color: var(--amber);
        }
        .breaker .local {
          color: var(--green);
        }
        .costbar {
          margin-top: 12px;
          display: flex;
          flex-direction: column;
          gap: 9px;
        }
        .cbrow {
          display: flex;
          align-items: center;
          gap: 9px;
          font-size: 11.5px;
          font-weight: 700;
          color: var(--muted);
        }
        .cbrow .lab {
          width: 78px;
          color: var(--muted);
          text-align: right;
        }
        .cbrow .track {
          flex: 1;
          height: 13px;
          border-radius: 7px;
          background: var(--line);
          overflow: hidden;
          position: relative;
        }
        .cbrow .cost {
          position: absolute;
          left: 0;
          top: 0;
          bottom: 0;
          background: var(--action);
          border-radius: 7px;
          transform-origin: left center;
          animation: tb-grow 0.9s cubic-bezier(0.4, 0, 0.2, 1) both;
        }
        .cbrow .surplus {
          position: absolute;
          top: 0;
          bottom: 0;
          background: repeating-linear-gradient(
            45deg,
            var(--purple),
            var(--purple) 5px,
            #a98bff 5px,
            #a98bff 10px
          );
          transform-origin: left center;
          animation: tb-grow 0.9s cubic-bezier(0.4, 0, 0.2, 1) 0.55s both;
        }
        .cbrow .cnote.purple {
          color: var(--purple);
        }
        .closer {
          text-align: center;
          padding: 6px 24px 32px;
        }
        .closer .big {
          font-size: 21px;
          font-weight: 800;
          letter-spacing: -0.01em;
          max-width: 30ch;
          margin: 0 auto;
          color: var(--ink);
        }
        .closer .en {
          font-family: ui-monospace, monospace;
          font-size: 12px;
          color: var(--purple);
          font-weight: 700;
          margin-top: 6px;
        }
        @keyframes tb-grow {
          from {
            transform: scaleX(0);
          }
          to {
            transform: scaleX(1);
          }
        }
        @keyframes tb-pop {
          0% {
            opacity: 0;
            transform: scale(0.7);
          }
          60% {
            transform: scale(1.12);
          }
          100% {
            opacity: 1;
            transform: scale(1);
          }
        }
        @keyframes tb-dash {
          to {
            background-position: 16px 0;
          }
        }
        @keyframes tb-flow {
          0% {
            left: 4%;
            opacity: 0;
          }
          15% {
            opacity: 1;
          }
          85% {
            opacity: 1;
          }
          100% {
            left: 90%;
            opacity: 0;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .budget i,
          .cbrow .cost,
          .cbrow .surplus,
          .meter-x .gauge i,
          .save {
            animation: none;
          }
          .pool .spark {
            display: none;
          }
        }
      `}</style>
    </div>
  );
}
