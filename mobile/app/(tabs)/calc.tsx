/**
 * Calc screen: 5-tab bench calculator (offline, pure client-side math).
 *
 * Tabs: Scientific, Molarity, Dilution, Serial dilution, Buffer recipe.
 * Each tab live-recomputes on every keystroke and shows results in a sky-tinted
 * Card. A horizontal chip row at the top switches tabs. Sequence and
 * nucleic-acid tools (Primer Tm, Protein, DNA/RNA) live on the laptop, not here.
 *
 * Phase 2 calc export: each tab has an "Export to notebook" button that, when
 * an experiment is open on the laptop, appends the formula + result as a plain
 * line to the chosen doc tab (Lab Notes or Results). The line format is:
 *   Scientific:      <expr> = <result>          e.g. "5 * 2 + 7 = 17"
 *   Molarity:        MW <mw> g/mol, <conc><cu> in <vol><vu> = <mass>
 *   Dilution:        C1 <c1><c1u> -> C2 <c2><c2u>, V2 <v2><v2u> = V1 <v1>
 *   Serial dilution: <start><su> / <fold>x / <steps> steps = [t1: c1, ...]
 *   Buffer:          Buffer <total><tu>: <comp1>=<vol1>, ...
 *
 * Pure functions come from mobile/lib/calculators/ which are already on main.
 *
 * House style: no em-dashes, no emojis, no mid-sentence colons.
 */

import { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useRouter } from 'expo-router';

import { getFocusContext } from '@/lib/focus-context';
import { usePairing } from '@/lib/pairing';
import { postAppendLine } from '@/lib/calc-export';
import { fireSuccess } from '@/lib/success-burst';

import { Card } from '@/components/ui/Card';
import { ScreenFrame } from '@/components/ui/ScreenFrame';
import { TabHeader } from '@/components/ui/TabHeader';
import { useUnreadNotificationCount } from '@/lib/unread-notifications';
import { palette, radii, spacing, useTheme } from '@/lib/design';

import {
  evaluateExpression,
  type AngleMode,
} from '@/lib/calculators/scientific';
import {
  molesFromMass,
  massFromConcVolumeMw,
  concFromMolesVolume,
  dilutionV1,
  serialDilution,
  bufferRecipe,
  type SerialDilutionStep,
  type BufferComponentInput,
} from '@/lib/calculators/calculators';
import {
  parseNum,
  formatNum,
  concToBase,
  volToBase,
  volFromBase,
  massToBase,
  moleFromBase,
  CONC_UNITS,
  VOL_UNITS,
  MASS_UNITS,
  type ConcUnit,
  type VolUnit,
  type MassUnit,
} from '@/lib/calculators/units';

// ---------------------------------------------------------------------------
// Tab metadata
// ---------------------------------------------------------------------------

type TabId =
  | 'scientific'
  | 'molarity'
  | 'dilution'
  | 'serial'
  | 'buffer';

const TABS: { id: TabId; label: string }[] = [
  { id: 'scientific', label: 'Scientific' },
  { id: 'molarity', label: 'Molarity' },
  { id: 'dilution', label: 'Dilution' },
  { id: 'serial', label: 'Serial dilution' },
  { id: 'buffer', label: 'Buffer' },
];

// ---------------------------------------------------------------------------
// Root screen
// ---------------------------------------------------------------------------

export default function CalcScreen() {
  const [activeTab, setActiveTab] = useState<TabId>('scientific');
  const { spacing: sp } = useTheme();
  const unreadCount = useUnreadNotificationCount();

  return (
    <ScreenFrame>
      {/* Shared tab header, then the calculator chip selector below it. */}
      <View style={styles.calcHeaderWrap}>
        <TabHeader title="Calc" unreadCount={unreadCount} />
      </View>
      <View style={styles.switcherWrap}>
        <CalcHeader active={activeTab} onChange={setActiveTab} />
      </View>

      {/* Tab body */}
      <ScrollView
        style={styles.fill}
        contentContainerStyle={[styles.body, { paddingBottom: sp.xxl + 16 }]}
        keyboardShouldPersistTaps="handled"
      >
        {/* Synced custom + lab calculators (the ones built on the laptop). Only
            shown once paired, since they arrive over the relay. The built-in
            tabs below are always available offline. */}
        <LabCalculatorsLink />

        {activeTab === 'scientific' && <ScientificTab />}
        {activeTab === 'molarity' && <MolarityTab />}
        {activeTab === 'dilution' && <DilutionTab />}
        {activeTab === 'serial' && <SerialTab />}
        {activeTab === 'buffer' && <BufferTab />}
      </ScrollView>
    </ScreenFrame>
  );
}

// ---------------------------------------------------------------------------
// Calculator header: large title + horizontal chip selector
// ---------------------------------------------------------------------------

// Compact chip labels for the row (shorter than the full tab names so the
// selector stays tidy now that the dropdown is gone).
const CHIP_LABEL: Record<TabId, string> = {
  scientific: 'Scientific',
  molarity: 'Molarity',
  dilution: 'Dilution',
  serial: 'Serial',
  buffer: 'Buffer',
};

function CalcHeader({
  active,
  onChange,
}: {
  active: TabId;
  onChange: (id: TabId) => void;
}) {
  const { surface } = useTheme();
  return (
    <>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipRow}
        keyboardShouldPersistTaps="handled"
      >
        {TABS.map((t) => {
          const on = t.id === active;
          return (
            <Pressable
              key={t.id}
              testID={`calc-tab-${t.id}`}
              onPress={() => onChange(t.id)}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`${CHIP_LABEL[t.id]} calculator`}
              style={[
                styles.calcChip,
                on
                  ? styles.calcChipOn
                  : { backgroundColor: surface.surface, borderColor: surface.border },
              ]}
            >
              <Text
                style={[
                  styles.calcChipLabel,
                  { color: on ? palette.white : surface.muted, fontWeight: on ? '700' : '600' },
                ]}
              >
                {CHIP_LABEL[t.id]}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </>
  );
}

// ---------------------------------------------------------------------------
// Lab calculators link (synced custom + lab calculators, Phase 3)
// ---------------------------------------------------------------------------

// A tappable card that opens the synced custom-calculator viewer (calc-custom).
// Only rendered when the phone is paired, since those calculators arrive over
// the relay from the laptop. The built-in tabs stay available offline either
// way. We do not fetch a count here (that is a sealed relay round-trip); the
// viewer itself shows the list, loading, and empty states.
function LabCalculatorsLink() {
  const { surface } = useTheme();
  const { pairing } = usePairing();
  const router = useRouter();

  if (!pairing) return null;

  return (
    <Pressable
      onPress={() => router.push('/calc-custom')}
      accessibilityRole="button"
      accessibilityLabel="Open your lab calculators"
      accessibilityHint="The calculators you built on the laptop, plus the ones your lab shares."
      style={({ pressed }) => [
        styles.labLink,
        {
          backgroundColor: pressed ? palette.amber : palette.skyDim,
          borderColor: pressed ? palette.amber : palette.skyBorder,
          borderRadius: radii.md,
        },
      ]}
    >
      {({ pressed }) => (
        <View style={styles.labLinkRow}>
          <View style={styles.labLinkText}>
            <Text style={[styles.labLinkTitle, { color: pressed ? palette.white : palette.sky }]}>
              Your lab calculators
            </Text>
            <Text
              style={[
                styles.labLinkSub,
                { color: pressed ? palette.white : surface.muted },
              ]}
            >
              Built on the laptop, run here at the bench
            </Text>
          </View>
          <Text style={[styles.labLinkChevron, { color: pressed ? palette.white : palette.sky }]}>
            {'›'}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Shared form primitives
// ---------------------------------------------------------------------------

function FieldLabel({ children }: { children: string }) {
  const { surface } = useTheme();
  return (
    <Text style={[styles.fieldLabel, { color: surface.muted }]}>{children}</Text>
  );
}

function NumericWithUnit<U extends string>({
  label,
  value,
  onValue,
  unit,
  onUnit,
  units,
  placeholder,
  inputTestID,
}: {
  label: string;
  value: string;
  onValue: (v: string) => void;
  unit: U;
  onUnit: (u: U) => void;
  units: readonly U[];
  placeholder?: string;
  inputTestID?: string;
}) {
  const { surface } = useTheme();
  return (
    <View style={styles.fieldWrap}>
      <FieldLabel>{label}</FieldLabel>
      <View style={styles.row}>
        <TextInput
          testID={inputTestID}
          style={[styles.numInput, { backgroundColor: surface.surface, borderColor: surface.border, color: surface.text, flex: 1 }]}
          value={value}
          onChangeText={onValue}
          keyboardType="decimal-pad"
          placeholder={placeholder ?? ''}
          placeholderTextColor={surface.placeholder}
          autoCorrect={false}
          autoCapitalize="none"
        />
        <View style={styles.unitRow}>
          {units.map((u) => {
            const active = u === unit;
            return (
              <Pressable
                key={u}
                onPress={() => onUnit(u)}
                style={({ pressed }) => [
                  styles.unitChip,
                  {
                    backgroundColor: pressed
                      ? palette.amber
                      : active
                        ? palette.sky
                        : surface.surface,
                    borderColor: pressed
                      ? palette.amber
                      : active
                        ? palette.sky
                        : surface.border,
                    borderRadius: radii.sm,
                  },
                ]}
              >
                {({ pressed }) => (
                  <Text
                    style={[
                      styles.unitLabel,
                      { color: pressed || active ? palette.white : surface.muted },
                    ]}
                  >
                    {u}
                  </Text>
                )}
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}

function PlainNumeric({
  label,
  value,
  onValue,
  placeholder,
  suffix,
  inputTestID,
}: {
  label: string;
  value: string;
  onValue: (v: string) => void;
  placeholder?: string;
  suffix?: string;
  inputTestID?: string;
}) {
  const { surface } = useTheme();
  return (
    <View style={styles.fieldWrap}>
      <FieldLabel>{label}</FieldLabel>
      <View style={styles.row}>
        <TextInput
          testID={inputTestID}
          style={[styles.numInput, { backgroundColor: surface.surface, borderColor: surface.border, color: surface.text, flex: 1 }]}
          value={value}
          onChangeText={onValue}
          keyboardType="decimal-pad"
          placeholder={placeholder ?? ''}
          placeholderTextColor={surface.placeholder}
          autoCorrect={false}
          autoCapitalize="none"
        />
        {suffix ? (
          <Text style={[styles.suffix, { color: surface.muted }]}>{suffix}</Text>
        ) : null}
      </View>
    </View>
  );
}

function ResultCard({ children, empty }: { children?: React.ReactNode; empty?: boolean }) {
  const { surface } = useTheme();
  if (empty) {
    return (
      <View
        style={[
          styles.resultEmpty,
          { borderColor: surface.border, backgroundColor: surface.sunken },
        ]}
      >
        <Text style={[styles.resultEmptyText, { color: surface.muted }]}>
          Enter the values above to see results.
        </Text>
      </View>
    );
  }
  return (
    <View style={[styles.resultFilled, { backgroundColor: palette.skyDim, borderColor: palette.skyBorder }]}>
      {children}
    </View>
  );
}

function ResultRow({ label, value }: { label: string; value: string }) {
  const { surface } = useTheme();
  return (
    <View style={styles.resultRow}>
      <Text style={[styles.resultLabel, { color: surface.muted }]}>{label}</Text>
      <Text style={[styles.resultValue, { color: surface.text }]}>{value}</Text>
    </View>
  );
}

function HintText({ children }: { children: string }) {
  return <Text style={[styles.hint, { color: palette.faint }]}>{children}</Text>;
}

// The per-tab formula tip. An amber callout with a small "f" badge that, once
// read, collapses to just the badge on tap (and re-expands when the badge is
// tapped again) so it never crowds the inputs. Grant 2026-06-10.
function HintCallout({ children }: { children: string }) {
  const { surface } = useTheme();
  const [collapsed, setCollapsed] = useState(false);

  if (collapsed) {
    return (
      <Pressable
        onPress={() => setCollapsed(false)}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Show the formula tip"
        style={({ pressed }) => [
          styles.hintBadge,
          styles.hintBadgeAlone,
          pressed && { backgroundColor: palette.coral },
        ]}
      >
        <Text style={styles.hintBadgeLabel}>f</Text>
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={() => setCollapsed(true)}
      accessibilityRole="button"
      accessibilityLabel="Hide the formula tip"
      style={({ pressed }) => [
        styles.hintCallout,
        pressed && { backgroundColor: 'rgba(245, 158, 11, 0.22)' },
      ]}
    >
      <View style={styles.hintBadge}>
        <Text style={styles.hintBadgeLabel}>f</Text>
      </View>
      <Text style={[styles.hintCalloutText, { color: surface.text }]}>{children}</Text>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Display helpers (auto-pick the friendliest unit)
// ---------------------------------------------------------------------------

function describeVol(baseL: number): string {
  const abs = Math.abs(baseL);
  if (abs < 1e-3) return `${formatNum(volFromBase(baseL, 'uL'))} uL`;
  if (abs < 1) return `${formatNum(volFromBase(baseL, 'mL'))} mL`;
  return `${formatNum(volFromBase(baseL, 'L'))} L`;
}

function describeMass(baseG: number): string {
  const abs = Math.abs(baseG);
  if (abs < 1e-6) return `${formatNum(baseG / 1e-9)} ng`;
  if (abs < 1e-3) return `${formatNum(baseG / 1e-6)} ug`;
  if (abs < 1) return `${formatNum(baseG / 1e-3)} mg`;
  return `${formatNum(baseG)} g`;
}

function describeMoles(baseMol: number): string {
  const abs = Math.abs(baseMol);
  if (abs < 1e-9) return `${formatNum(moleFromBase(baseMol, 'pmol'))} pmol`;
  if (abs < 1e-6) return `${formatNum(moleFromBase(baseMol, 'nmol'))} nmol`;
  if (abs < 1e-3) return `${formatNum(moleFromBase(baseMol, 'umol'))} umol`;
  if (abs < 1) return `${formatNum(moleFromBase(baseMol, 'mmol'))} mmol`;
  return `${formatNum(baseMol)} mol`;
}

function describeConc(baseM: number): string {
  const abs = Math.abs(baseM);
  if (abs < 1e-6) return `${formatNum(baseM / 1e-9)} nM`;
  if (abs < 1e-3) return `${formatNum(baseM / 1e-6)} uM`;
  if (abs < 1) return `${formatNum(baseM / 1e-3)} mM`;
  return `${formatNum(baseM)} M`;
}

// ---------------------------------------------------------------------------
// Export to notebook
// ---------------------------------------------------------------------------

/**
 * Hook that builds and posts an append-line command to the relay. Returns a
 * stable `exportLine` callback that fires the Notes/Results picker (or a
 * gentle prompt when no experiment is open) and sends the command on confirm.
 *
 * `lineText` is the fully-formatted "<expr> = <value>" string the caller
 * builds from its local state. Pass null when there is no result to export
 * (the button is disabled in that case).
 */
function useExport(lineText: string | null) {
  const { pairing } = usePairing();

  const exportLine = useCallback(async () => {
    if (!lineText) return;

    const userX25519PubHex = pairing?.userX25519PubHex ?? '';
    if (!pairing || !userX25519PubHex) {
      Alert.alert(
        'Not paired',
        'Pair your phone with a laptop running ResearchOS to export calc results to your notebook.',
        [{ text: 'OK' }],
      );
      return;
    }

    // Fetch focus context (what experiment is open on the laptop right now).
    let ctx: Awaited<ReturnType<typeof getFocusContext>> = null;
    try {
      ctx = await getFocusContext(pairing.relayUrl);
    } catch {
      ctx = null;
    }

    if (!ctx || ctx.kind !== 'experiment') {
      Alert.alert(
        'No experiment open',
        'Open an experiment on your laptop to export the result there.',
        [{ text: 'OK' }],
      );
      return;
    }

    const { taskId, owner, name, activeTab } = ctx;

    // When the laptop already has a specific doc tab visible (notes or results),
    // skip the picker and send directly there (locked decision A: auto-switch
    // + append). When the active tab is something else (e.g. Methods), ask.
    if (activeTab === 'notes' || activeTab === 'results') {
      try {
        await postAppendLine(taskId, owner, activeTab, lineText, userX25519PubHex, pairing.relayUrl);
        fireSuccess({ subtitle: `Appended to ${activeTab === 'results' ? 'Results' : 'Lab Notes'}` });
      } catch {
        // Best-effort. The relay is unreachable or the command post failed;
        // the user sees no crash but the line is not delivered.
      }
      return;
    }

    // Ambiguous tab: show the Notes / Results picker (same Alert pattern as
    // notebook.tsx sendWithRouting).
    await new Promise<void>((resolve) => {
      Alert.alert(
        `Export to ${name}?`,
        'Choose where this result should appear.',
        [
          {
            text: 'Lab Notes',
            onPress: () => {
              void postAppendLine(taskId, owner, 'notes', lineText, userX25519PubHex, pairing.relayUrl)
                .then(() => { fireSuccess({ subtitle: 'Appended to Lab Notes' }); })
                .catch(() => {})
                .finally(resolve);
            },
          },
          {
            text: 'Results',
            onPress: () => {
              void postAppendLine(taskId, owner, 'results', lineText, userX25519PubHex, pairing.relayUrl)
                .then(() => { fireSuccess({ subtitle: 'Appended to Results' }); })
                .catch(() => {})
                .finally(resolve);
            },
          },
          {
            text: 'Cancel',
            style: 'cancel',
            onPress: () => resolve(),
          },
        ],
        { cancelable: true, onDismiss: () => resolve() },
      );
    });
  }, [lineText, pairing]);

  return exportLine;
}

/**
 * A small "Export" button rendered below the result card when there is a
 * result to export. Disabled (greyed) when `lineText` is null.
 */
function ExportButton({ lineText }: { lineText: string | null }) {
  const { surface } = useTheme();
  const exportLine = useExport(lineText);
  const enabled = !!lineText;

  return (
    <Pressable
      onPress={() => { void exportLine(); }}
      disabled={!enabled}
      style={({ pressed }) => [
        styles.exportBtn,
        {
          backgroundColor: enabled
            ? pressed ? palette.amber : palette.skyDim
            : surface.sunken,
          borderColor: enabled
            ? pressed ? palette.amber : palette.skyBorder
            : surface.border,
          borderRadius: radii.md,
          opacity: enabled ? 1 : 0.5,
        },
      ]}
      accessibilityRole="button"
      accessibilityLabel="Export to notebook"
      accessibilityHint="Appends this result to the experiment open on your laptop."
    >
      {({ pressed }) => (
        <Text
          style={[
            styles.exportBtnLabel,
            { color: enabled ? (pressed ? palette.white : palette.sky) : surface.muted },
          ]}
        >
          Export to notebook
        </Text>
      )}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Tab 0: Scientific calculator
// ---------------------------------------------------------------------------

// Function strip entries: [display label, inserted token].
const FN_KEYS: [string, string][] = [
  ['sin', 'sin('],
  ['cos', 'cos('],
  ['tan', 'tan('],
  ['asin', 'asin('],
  ['acos', 'acos('],
  ['atan', 'atan('],
  ['ln', 'ln('],
  ['log', 'log10('],
  ['√', 'sqrt('],
  ['xⁿ', '^'],
  ['(', '('],
  [')', ')'],
  ['π', 'pi'],
  ['e', 'e'],
  ['n!', '!'],
];

// Key tones: clear=coral, accent(del/Ans)=solid sky, eq=amber, op=sky tint,
// digit=white. Word keys (AC/del/Ans) use the smaller label.
type SciKeyVariant = 'digit' | 'op' | 'fnk' | 'eq' | 'clear' | 'accent';

const KEY_BG: Partial<Record<SciKeyVariant, string>> = {
  op: palette.skyDim,
  eq: palette.amber,
  clear: palette.coral,
  accent: palette.sky,
};
const KEY_FG: Partial<Record<SciKeyVariant, string>> = {
  op: palette.sky,
  eq: palette.white,
  clear: palette.white,
  accent: palette.white,
};

function SciKey({
  label,
  onPress,
  variant = 'digit',
  span2,
}: {
  label: string;
  onPress: () => void;
  variant?: SciKeyVariant;
  span2?: boolean;
}) {
  const { surface } = useTheme();
  const bg = KEY_BG[variant] ?? (variant === 'fnk' ? surface.sunken : surface.surface);
  const color = KEY_FG[variant] ?? (variant === 'fnk' ? surface.muted : surface.text);
  const wordKey = variant === 'fnk' || variant === 'clear' || variant === 'accent';
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.padKey,
        span2 && styles.padKeySpan2,
        { backgroundColor: pressed ? palette.amber : bg },
        variant === 'digit' && !pressed && { borderColor: surface.border, borderWidth: 1 },
      ]}
    >
      {({ pressed }) => (
        <Text
          style={[
            styles.padKeyLabel,
            { color: pressed ? palette.white : color },
            wordKey && styles.padKeyLabelSm,
          ]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

function ScientificTab() {
  const { surface } = useTheme();
  const [expr, setExpr] = useState('');
  const [angleMode, setAngleMode] = useState<AngleMode>('rad');
  const [ans, setAns] = useState(0);

  const result = useMemo(
    () => evaluateExpression(expr, { angleMode, ans, memory: 0 }),
    [expr, angleMode, ans],
  );

  const insert = (text: string) => setExpr((prev) => prev + text);
  const backspace = () => setExpr((prev) => prev.slice(0, -1));
  const clear = () => setExpr('');
  const commit = () => {
    if (!result.ok) return;
    setAns(result.value);
    setExpr(result.display);
  };

  const shown = result.ok ? result.display : expr.trim() === '' ? '0' : '…';

  // Export line: "<trimmed expr> = <display result>".
  // Only populated when there is a non-trivial expression and a valid result.
  const exportLine = useMemo<string | null>(() => {
    const trimmed = expr.trim();
    if (!trimmed || !result.ok) return null;
    return `${trimmed} = ${result.display}`;
  }, [expr, result]);

  return (
    <View style={styles.tabGap}>
      {/* Dark calculator display */}
      <View style={styles.disp}>
        <TextInput
          testID="calc-scientific-input"
          style={styles.dispExpr}
          value={expr}
          onChangeText={setExpr}
          placeholder="Type or tap the keys below"
          placeholderTextColor="#5b7088"
          autoCorrect={false}
          autoCapitalize="none"
          multiline={false}
          onSubmitEditing={commit}
          returnKeyType="done"
        />
        <Text testID="calc-scientific-result" style={styles.dispRes} numberOfLines={1} adjustsFontSizeToFit>
          {shown}
        </Text>
      </View>

      {/* RAD/DEG toggle + scrollable function strip */}
      <View style={styles.stripRow}>
        <View style={[styles.rdpill, { borderColor: surface.border }]}>
          {(['rad', 'deg'] as AngleMode[]).map((m) => (
            <Pressable
              key={m}
              onPress={() => setAngleMode(m)}
              style={[styles.rdseg, m === angleMode && { backgroundColor: palette.sky }]}
            >
              <Text style={[styles.rdsegLabel, { color: m === angleMode ? palette.white : surface.muted }]}>
                {m.toUpperCase()}
              </Text>
            </Pressable>
          ))}
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.fnstrip}
          keyboardShouldPersistTaps="handled"
        >
          {FN_KEYS.map(([label, token]) => (
            <Pressable
              key={label}
              onPress={() => insert(token)}
              style={({ pressed }) => [styles.fnchip, pressed && { backgroundColor: palette.amber }]}
            >
              {({ pressed }) => (
                <Text style={[styles.fnchipLabel, pressed && { color: palette.white }]}>{label}</Text>
              )}
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {/* Number pad */}
      <View style={styles.padGrid}>
        <SciKey label="AC" onPress={clear} variant="clear" />
        <SciKey label="⌫" onPress={backspace} variant="accent" />
        <SciKey label="Ans" onPress={() => insert('Ans')} variant="accent" />
        <SciKey label="÷" onPress={() => insert('/')} variant="op" />

        <SciKey label="7" onPress={() => insert('7')} />
        <SciKey label="8" onPress={() => insert('8')} />
        <SciKey label="9" onPress={() => insert('9')} />
        <SciKey label="×" onPress={() => insert('*')} variant="op" />

        <SciKey label="4" onPress={() => insert('4')} />
        <SciKey label="5" onPress={() => insert('5')} />
        <SciKey label="6" onPress={() => insert('6')} />
        <SciKey label="−" onPress={() => insert('-')} variant="op" />

        <SciKey label="1" onPress={() => insert('1')} />
        <SciKey label="2" onPress={() => insert('2')} />
        <SciKey label="3" onPress={() => insert('3')} />
        <SciKey label="+" onPress={() => insert('+')} variant="op" />

        <SciKey label="0" onPress={() => insert('0')} span2 />
        <SciKey label="." onPress={() => insert('.')} />
        <SciKey label="=" onPress={commit} variant="eq" />
      </View>

      <HintText>
        Computed live as you type. Functions in the strip, nothing is saved.
      </HintText>
      <ExportButton lineText={exportLine} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Tab 1: Molarity
// ---------------------------------------------------------------------------

function MolarityTab() {
  const [mw, setMw] = useState('');
  const [conc, setConc] = useState('');
  const [concU, setConcU] = useState<ConcUnit>('mM');
  const [vol, setVol] = useState('');
  const [volU, setVolU] = useState<VolUnit>('mL');
  const [mass, setMass] = useState('');
  const [massU, setMassU] = useState<MassUnit>('mg');

  const mwN = parseNum(mw);
  const concN = parseNum(conc);
  const volN = parseNum(vol);
  const massN = parseNum(mass);

  let weighOutG: number | null = null;
  let molesFromMassN: number | null = null;
  let concFromMassN: number | null = null;

  try {
    if (mwN !== null && concN !== null && volN !== null) {
      weighOutG = massFromConcVolumeMw(concToBase(concN, concU), volToBase(volN, volU), mwN);
    }
    if (mwN !== null && massN !== null) {
      molesFromMassN = molesFromMass(massToBase(massN, massU), mwN);
    }
    if (molesFromMassN !== null && volN !== null) {
      concFromMassN = concFromMolesVolume(molesFromMassN, volToBase(volN, volU));
    }
  } catch {
    // partial input, show nothing
  }

  const hasResult = weighOutG !== null || molesFromMassN !== null;

  // Export line. Weigh-out direction: "MW <mw> g/mol, <conc><cu> in <vol><vu> = <mass>".
  // Reverse (mass -> moles) direction: "MW <mw> g/mol, <mass><mu> = <moles> (<conc>)".
  // When both are active (mass + conc + vol all filled), prefer weigh-out.
  const molarityExportLine = useMemo<string | null>(() => {
    if (!hasResult || mwN === null) return null;
    if (weighOutG !== null && concN !== null && volN !== null) {
      return `MW ${formatNum(mwN)} g/mol, ${formatNum(concN)} ${concU} in ${formatNum(volN)} ${volU} = ${describeMass(weighOutG)}`;
    }
    if (molesFromMassN !== null && massN !== null) {
      const concPart = concFromMassN !== null ? ` (${describeConc(concFromMassN)})` : '';
      return `MW ${formatNum(mwN)} g/mol, ${formatNum(massN)} ${massU} = ${describeMoles(molesFromMassN)}${concPart}`;
    }
    return null;
  }, [hasResult, mwN, weighOutG, concN, volN, concU, volU, massN, massU, molesFromMassN, concFromMassN]);

  return (
    <View style={styles.tabGap}>
      <HintCallout>
        n = m / MW, C = n / V. Enter MW plus target concentration and volume to get the mass to weigh out. Or enter a mass to get moles and concentration.
      </HintCallout>
      <PlainNumeric inputTestID="calc-molarity-mw" label="Molecular weight (g/mol)" value={mw} onValue={setMw} placeholder="e.g. 58.44" />
      <NumericWithUnit inputTestID="calc-molarity-conc" label="Target concentration" value={conc} onValue={setConc} unit={concU} onUnit={setConcU} units={CONC_UNITS} />
      <NumericWithUnit inputTestID="calc-molarity-vol" label="Volume" value={vol} onValue={setVol} unit={volU} onUnit={setVolU} units={VOL_UNITS} />
      <NumericWithUnit label="Mass (optional, reverse direction)" value={mass} onValue={setMass} unit={massU} onUnit={setMassU} units={MASS_UNITS} />

      <ResultCard empty={!hasResult}>
        {weighOutG !== null ? (
          <ResultRow label="Mass to weigh out" value={describeMass(weighOutG)} />
        ) : null}
        {molesFromMassN !== null ? (
          <ResultRow label="Amount (from mass)" value={describeMoles(molesFromMassN)} />
        ) : null}
        {concFromMassN !== null ? (
          <ResultRow label="Resulting concentration" value={describeConc(concFromMassN)} />
        ) : null}
      </ResultCard>
      <ExportButton lineText={molarityExportLine} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Tab 2: Dilution
// ---------------------------------------------------------------------------

function DilutionTab() {
  const [c1, setC1] = useState('');
  const [c1u, setC1u] = useState<ConcUnit>('mM');
  const [c2, setC2] = useState('');
  const [c2u, setC2u] = useState<ConcUnit>('uM');
  const [v2, setV2] = useState('');
  const [v2u, setV2u] = useState<VolUnit>('mL');

  const c1n = parseNum(c1);
  const c2n = parseNum(c2);
  const v2n = parseNum(v2);

  let v1L: number | null = null;
  let diluentL: number | null = null;
  let overflow = false;

  try {
    if (c1n !== null && c2n !== null && v2n !== null) {
      v1L = dilutionV1(concToBase(c1n, c1u), concToBase(c2n, c2u), volToBase(v2n, v2u));
    }
    const v2L = v2n !== null ? volToBase(v2n, v2u) : null;
    if (v1L !== null && v2L !== null) {
      overflow = v1L > v2L;
      diluentL = overflow ? null : v2L - v1L;
    }
  } catch {
    // partial input
  }

  // Export line: "C1 <c1><c1u> -> C2 <c2><c2u>, V2 <v2><v2u> = V1 <v1>, diluent <dil>"
  const dilutionExportLine = useMemo<string | null>(() => {
    if (v1L === null || overflow || c1n === null || c2n === null || v2n === null) return null;
    const base = `C1 ${formatNum(c1n)} ${c1u} -> C2 ${formatNum(c2n)} ${c2u}, V2 ${formatNum(v2n)} ${v2u} = V1 ${describeVol(v1L)}`;
    return diluentL !== null ? `${base}, diluent ${describeVol(diluentL)}` : base;
  }, [v1L, overflow, c1n, c2n, v2n, c1u, c2u, v2u, diluentL]);

  return (
    <View style={styles.tabGap}>
      <HintCallout>
        C1 V1 = C2 V2. Enter stock concentration, the final concentration, and the final volume. Solves for how much stock to add.
      </HintCallout>
      <NumericWithUnit label="Stock concentration (C1)" value={c1} onValue={setC1} unit={c1u} onUnit={setC1u} units={CONC_UNITS} />
      <NumericWithUnit label="Final concentration (C2)" value={c2} onValue={setC2} unit={c2u} onUnit={setC2u} units={CONC_UNITS} />
      <NumericWithUnit label="Final volume (V2)" value={v2} onValue={setV2} unit={v2u} onUnit={setV2u} units={VOL_UNITS} />

      <ResultCard empty={v1L === null && !overflow}>
        {overflow ? (
          <Text style={[styles.hint, { color: palette.warning }]}>
            Final concentration is higher than the stock. Check your inputs.
          </Text>
        ) : null}
        {v1L !== null && !overflow ? (
          <>
            <ResultRow label="Stock to add (V1)" value={describeVol(v1L)} />
            {diluentL !== null ? (
              <ResultRow label="Diluent to add" value={describeVol(diluentL)} />
            ) : null}
          </>
        ) : null}
      </ResultCard>
      <ExportButton lineText={dilutionExportLine} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Tab 3: Serial dilution
// ---------------------------------------------------------------------------

function SerialTab() {
  const [start, setStart] = useState('');
  const [startU, setStartU] = useState<ConcUnit>('uM');
  const [fold, setFold] = useState('10');
  const [steps, setSteps] = useState('5');
  const [vol, setVol] = useState('');
  const [volU, setVolU] = useState<VolUnit>('uL');
  const { surface } = useTheme();

  const startN = parseNum(start);
  const foldN = parseNum(fold);
  const stepsN = parseNum(steps);
  const volN = parseNum(vol);

  const rows: SerialDilutionStep[] = useMemo(() => {
    try {
      if (startN === null || foldN === null || stepsN === null || volN === null) return [];
      return serialDilution(startN, foldN, stepsN, volN);
    } catch {
      return [];
    }
  }, [startN, foldN, stepsN, volN]);

  // Export line: "Serial <start> <su> / <fold>x / <steps> steps: t1=<c1> <su>, ..."
  // Each tube carries its unit (startU) so a tube value is never ambiguous out
  // of context (Grant 2026-06-09).
  const serialExportLine = useMemo<string | null>(() => {
    if (rows.length === 0 || startN === null || foldN === null) return null;
    const tubeList = rows
      .map((r) => `t${r.step}=${formatNum(r.concentration)} ${startU}`)
      .join(', ');
    return `Serial ${formatNum(startN)} ${startU} / ${formatNum(foldN)}x / ${rows.length} steps: ${tubeList}`;
  }, [rows, startN, foldN, startU]);

  return (
    <View style={styles.tabGap}>
      <HintCallout>
        Each tube takes a fixed transfer from the previous tube and tops up with diluent, giving an equal fold dilution per step.
      </HintCallout>
      <NumericWithUnit label="Starting concentration" value={start} onValue={setStart} unit={startU} onUnit={setStartU} units={CONC_UNITS} />
      <NumericWithUnit label="Per-tube final volume" value={vol} onValue={setVol} unit={volU} onUnit={setVolU} units={VOL_UNITS} />
      <PlainNumeric label="Fold factor (per step)" value={fold} onValue={setFold} placeholder="e.g. 10" suffix="x" />
      <PlainNumeric label="Number of steps" value={steps} onValue={setSteps} placeholder="e.g. 5" />

      {rows.length === 0 ? (
        <ResultCard empty />
      ) : (
        <View style={[styles.table, { borderColor: palette.skyBorder, backgroundColor: palette.skyDim }]}>
          <View style={[styles.tableRow, { borderBottomColor: palette.skyBorder }]}>
            <Text style={[styles.tableHead, { color: surface.muted, flex: 0.5 }]}>Tube</Text>
            <Text style={[styles.tableHead, { color: surface.muted, flex: 2 }]}>Conc ({startU})</Text>
            <Text style={[styles.tableHead, { color: surface.muted, flex: 1.5 }]}>Sample ({volU})</Text>
            <Text style={[styles.tableHead, { color: surface.muted, flex: 1.5 }]}>Diluent ({volU})</Text>
          </View>
          {rows.map((r) => (
            <View key={r.step} style={[styles.tableRow, { borderBottomColor: surface.border }]}>
              <Text style={[styles.tableCell, { color: surface.text, flex: 0.5 }]}>{r.step}</Text>
              <Text style={[styles.tableCell, { color: surface.text, flex: 2 }]}>
                {formatNum(r.concentration)}
              </Text>
              <Text style={[styles.tableCell, { color: surface.text, flex: 1.5 }]}>
                {formatNum(r.sampleVolume)}
              </Text>
              <Text style={[styles.tableCell, { color: surface.text, flex: 1.5 }]}>
                {formatNum(r.diluentVolume)}
              </Text>
            </View>
          ))}
        </View>
      )}
      <ExportButton lineText={serialExportLine} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Tab 4: Buffer recipe
// ---------------------------------------------------------------------------

interface BufferRow {
  id: number;
  name: string;
  conc: string;
  concU: ConcUnit;
  stock: string;
  stockU: ConcUnit;
}

let _bufRowSeq = 0;
function makeBufferRow(): BufferRow {
  _bufRowSeq += 1;
  return { id: _bufRowSeq, name: '', conc: '', concU: 'mM', stock: '', stockU: 'M' };
}

function BufferTab() {
  const [rows, setRows] = useState<BufferRow[]>(() => [makeBufferRow(), makeBufferRow()]);
  const [total, setTotal] = useState('');
  const [totalU, setTotalU] = useState<VolUnit>('mL');
  const { surface } = useTheme();

  const totalN = parseNum(total);
  const totalL = totalN !== null ? volToBase(totalN, totalU) : null;

  const result = useMemo(() => {
    try {
      if (totalL === null) return null;
      const comps: BufferComponentInput[] = rows.map((r) => {
        const cn = parseNum(r.conc);
        const sn = parseNum(r.stock);
        return {
          name: r.name.trim() || 'Component',
          finalConcM: cn !== null ? concToBase(cn, r.concU) : 0,
          stockConcM: sn !== null ? concToBase(sn, r.stockU) : 0,
        };
      });
      return bufferRecipe(comps, totalL);
    } catch {
      return null;
    }
  }, [rows, totalL]);

  const update = (id: number, patch: Partial<BufferRow>) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const remove = (id: number) =>
    setRows((prev) => (prev.length > 1 ? prev.filter((r) => r.id !== id) : prev));

  // Export line: "Buffer <total><tu>: <comp>=<vol>, ..., diluent <dil>"
  const bufferExportLine = useMemo<string | null>(() => {
    if (result === null || result.overflows || totalN === null) return null;
    const compParts = result.components
      .filter((c) => c.volumeL !== null)
      .map((c) => `${c.name}=${describeVol(c.volumeL!)}`)
      .join(', ');
    if (!compParts) return null;
    const dilPart = result.diluentL !== null ? `, diluent ${describeVol(result.diluentL)}` : '';
    return `Buffer ${formatNum(totalN)} ${totalU}: ${compParts}${dilPart}`;
  }, [result, totalN, totalU]);

  return (
    <View style={styles.tabGap}>
      <HintCallout>
        Volume of stock = (final conc x total volume) / stock conc. The leftover is your diluent.
      </HintCallout>
      <NumericWithUnit label="Total volume" value={total} onValue={setTotal} unit={totalU} onUnit={setTotalU} units={VOL_UNITS} />

      {rows.map((r) => (
        <Card key={r.id} compact>
          <View style={styles.row}>
            <TextInput
              style={[styles.nameInput, { backgroundColor: surface.surface, borderColor: surface.border, color: surface.text, flex: 1 }]}
              value={r.name}
              onChangeText={(v) => update(r.id, { name: v })}
              placeholder="Component name"
              placeholderTextColor={surface.placeholder}
              autoCorrect={false}
            />
            {rows.length > 1 ? (
              <Pressable
                onPress={() => remove(r.id)}
                style={({ pressed }) => [
                  styles.removeBtn,
                  { backgroundColor: pressed ? palette.coral : palette.dangerLight, borderRadius: radii.sm },
                ]}
              >
                {({ pressed }) => (
                  <Text style={{ color: pressed ? palette.white : palette.danger, fontWeight: '700', fontSize: 16 }}>
                    &times;
                  </Text>
                )}
              </Pressable>
            ) : null}
          </View>
          <NumericWithUnit
            label="Final concentration"
            value={r.conc}
            onValue={(v) => update(r.id, { conc: v })}
            unit={r.concU}
            onUnit={(u) => update(r.id, { concU: u })}
            units={CONC_UNITS}
          />
          <NumericWithUnit
            label="Stock concentration"
            value={r.stock}
            onValue={(v) => update(r.id, { stock: v })}
            unit={r.stockU}
            onUnit={(u) => update(r.id, { stockU: u })}
            units={CONC_UNITS}
          />
        </Card>
      ))}

      <Pressable
        onPress={() => setRows((prev) => [...prev, makeBufferRow()])}
        style={({ pressed }) => [
          styles.addBtn,
          {
            borderColor: pressed ? palette.amber : palette.skyBorder,
            backgroundColor: pressed ? palette.amber : palette.skyDim,
            borderRadius: radii.md,
          },
        ]}
      >
        {({ pressed }) => (
          <Text style={[styles.addBtnLabel, { color: pressed ? palette.white : palette.sky }]}>
            + Add component
          </Text>
        )}
      </Pressable>

      {result === null ? (
        <ResultCard empty />
      ) : (
        <ResultCard>
          {result.overflows ? (
            <Text style={[styles.hint, { color: palette.warning }]}>
              Stock volumes exceed total volume. Check your inputs.
            </Text>
          ) : null}
          {result.components.map((c, i) => (
            <ResultRow
              key={i}
              label={c.name}
              value={c.volumeL !== null ? describeVol(c.volumeL) : '-'}
            />
          ))}
          {result.diluentL !== null ? (
            <View style={[styles.divider, { borderTopColor: palette.skyBorder }]}>
              <ResultRow label="Diluent (top up)" value={describeVol(result.diluentL)} />
            </View>
          ) : null}
        </ResultCard>
      )}
      <ExportButton lineText={bufferExportLine} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  fill: { flex: 1 },

  // Calculator header: large title + horizontal chip selector
  calcHeaderWrap: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  switcherWrap: { paddingTop: spacing.sm, paddingBottom: spacing.sm },
  chipRow: { gap: 8, paddingHorizontal: spacing.lg, paddingVertical: 2 },
  calcChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    shadowColor: '#101828',
    shadowOpacity: 0.05,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  calcChipOn: { backgroundColor: palette.sky, borderColor: palette.sky, elevation: 0, shadowOpacity: 0 },
  calcChipLabel: { fontSize: 13 },

  body: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    gap: spacing.lg,
  },
  // Lab calculators link card
  labLink: {
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  labLinkRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  labLinkText: { flex: 1, gap: 2 },
  labLinkTitle: { fontSize: 15, fontWeight: '700' },
  labLinkSub: { fontSize: 12, lineHeight: 16 },
  labLinkChevron: { fontSize: 22, fontWeight: '700' },
  tabGap: { gap: spacing.md },
  fieldWrap: { gap: spacing.xs },
  fieldLabel: { fontSize: 12, fontWeight: '600', letterSpacing: 0.2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  numInput: {
    borderWidth: 1,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: 16,
    minHeight: 44,
  },
  nameInput: {
    borderWidth: 1,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    fontSize: 15,
    minHeight: 40,
  },
  suffix: { fontSize: 14, fontWeight: '500', minWidth: 36 },
  unitRow: { flexDirection: 'row', gap: 4, flexWrap: 'wrap' },
  unitChip: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderWidth: 1,
    minWidth: 36,
    alignItems: 'center',
  },
  unitLabel: { fontSize: 12, fontWeight: '700' },
  resultEmpty: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: radii.md,
    padding: spacing.lg,
    alignItems: 'center',
  },
  resultEmptyText: { fontSize: 14 },
  resultFilled: {
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.lg,
    gap: 6,
  },
  resultRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: spacing.md,
    paddingVertical: 2,
  },
  resultLabel: { fontSize: 14, lineHeight: 20 },
  resultValue: { fontSize: 16, fontWeight: '600', lineHeight: 22, textAlign: 'right' },
  hint: { fontSize: 13, lineHeight: 18 },
  // Collapsible amber formula callout
  hintCallout: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
    backgroundColor: 'rgba(245, 158, 11, 0.13)',
    borderRadius: 12,
    padding: 11,
  },
  hintBadge: {
    width: 22,
    height: 22,
    borderRadius: 6,
    backgroundColor: palette.amber,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hintBadgeAlone: {
    width: 30,
    height: 30,
    borderRadius: 9,
    alignSelf: 'flex-start',
  },
  hintBadgeLabel: {
    color: palette.white,
    fontSize: 14,
    fontWeight: '800',
    fontStyle: 'italic',
  },
  hintCalloutText: { flex: 1, fontSize: 13, lineHeight: 19 },
  table: {
    borderWidth: 1,
    borderRadius: radii.md,
    overflow: 'hidden',
  },
  tableRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tableHead: { fontSize: 11, fontWeight: '700', letterSpacing: 0.3 },
  tableCell: { fontSize: 13, fontFamily: 'Courier' },
  divider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 6,
    marginTop: 4,
  },
  addBtn: {
    paddingVertical: spacing.md,
    alignItems: 'center',
    borderWidth: 1,
  },
  addBtnLabel: { fontSize: 15, fontWeight: '600' },
  // Phase 2: Export to notebook button
  exportBtn: {
    paddingVertical: spacing.md,
    alignItems: 'center',
    borderWidth: 1,
    marginTop: 2,
  },
  exportBtnLabel: { fontSize: 15, fontWeight: '600' },
  removeBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Scientific calculator: dark display
  disp: {
    backgroundColor: '#0c1422',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 6,
  },
  dispExpr: {
    color: '#cfe0f0',
    fontFamily: 'Courier',
    fontSize: 15,
    textAlign: 'right',
    minHeight: 20,
    padding: 0,
  },
  dispRes: {
    color: '#ffffff',
    fontSize: 34,
    fontWeight: '700',
    textAlign: 'right',
    letterSpacing: -0.5,
  },

  // Function strip
  stripRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rdpill: { flexDirection: 'row', borderWidth: 1, borderRadius: 10, overflow: 'hidden' },
  rdseg: { paddingHorizontal: 11, paddingVertical: 9 },
  rdsegLabel: { fontSize: 12, fontWeight: '700' },
  fnstrip: { gap: 7, paddingRight: 4, alignItems: 'center' },
  fnchip: {
    backgroundColor: palette.skyDim,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  fnchipLabel: { color: palette.sky, fontSize: 14, fontWeight: '700', fontFamily: 'Courier' },

  // Number pad (4-col)
  padGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  padKey: {
    width: '22.7%',
    height: 58,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#101828',
    shadowOpacity: 0.05,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
  },
  padKeySpan2: { width: '48.1%' },
  padKeyLabel: { fontSize: 22, fontWeight: '600' },
  padKeyLabelSm: { fontSize: 16, fontWeight: '700' },
});
