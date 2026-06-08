/**
 * Calc screen: 5-tab bench calculator (offline, pure client-side math).
 *
 * Tabs: Scientific, Molarity, Dilution, Serial dilution, Buffer recipe.
 * Each tab live-recomputes on every keystroke and shows results in a sky-tinted
 * Card. A horizontal chip row at the top switches tabs. Sequence and
 * nucleic-acid tools (Primer Tm, Protein, DNA/RNA) live on the laptop, not here.
 *
 * Pure functions come from mobile/lib/calculators/ which are already on main.
 * No writes, no network, no storage.
 *
 * House style: no em-dashes, no emojis, no mid-sentence colons.
 */

import { useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Card } from '@/components/ui/Card';
import { ScreenFrame } from '@/components/ui/ScreenFrame';
import { palette, radii, spacing, useTheme } from '@/lib/design';

import {
  evaluateExpression,
  formatResult,
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
  const { surface, spacing: sp } = useTheme();

  return (
    <ScreenFrame>
      {/* Horizontal scrollable tab chip row */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={[styles.chipScroll, { borderBottomColor: surface.border }]}
        contentContainerStyle={styles.chipRow}
      >
        {TABS.map((t) => {
          const active = t.id === activeTab;
          return (
            <Pressable
              key={t.id}
              onPress={() => setActiveTab(t.id)}
              style={[
                styles.chip,
                {
                  backgroundColor: active ? palette.sky : surface.sunken,
                  borderRadius: radii.pill,
                },
              ]}
            >
              <Text
                style={[
                  styles.chipLabel,
                  { color: active ? palette.white : surface.muted },
                ]}
              >
                {t.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Tab body */}
      <ScrollView
        style={styles.fill}
        contentContainerStyle={[styles.body, { paddingBottom: sp.xxl + 16 }]}
        keyboardShouldPersistTaps="handled"
      >
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
}: {
  label: string;
  value: string;
  onValue: (v: string) => void;
  unit: U;
  onUnit: (u: U) => void;
  units: readonly U[];
  placeholder?: string;
}) {
  const { surface } = useTheme();
  return (
    <View style={styles.fieldWrap}>
      <FieldLabel>{label}</FieldLabel>
      <View style={styles.row}>
        <TextInput
          style={[styles.numInput, { borderColor: surface.border, color: surface.text, flex: 1 }]}
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
                style={[
                  styles.unitChip,
                  {
                    backgroundColor: active ? palette.skyDim : surface.sunken,
                    borderColor: active ? palette.skyBorder : surface.border,
                    borderRadius: radii.sm,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.unitLabel,
                    { color: active ? palette.sky : surface.muted },
                  ]}
                >
                  {u}
                </Text>
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
}: {
  label: string;
  value: string;
  onValue: (v: string) => void;
  placeholder?: string;
  suffix?: string;
}) {
  const { surface } = useTheme();
  return (
    <View style={styles.fieldWrap}>
      <FieldLabel>{label}</FieldLabel>
      <View style={styles.row}>
        <TextInput
          style={[styles.numInput, { borderColor: surface.border, color: surface.text, flex: 1 }]}
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
  const { surface } = useTheme();
  return <Text style={[styles.hint, { color: surface.muted }]}>{children}</Text>;
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
// Tab 0: Scientific calculator
// ---------------------------------------------------------------------------

function ScientificTab() {
  const { surface } = useTheme();
  const [expr, setExpr] = useState('');
  const [angleMode, setAngleMode] = useState<AngleMode>('rad');
  const [ans, setAns] = useState(0);
  const [memory, setMemory] = useState(0);

  const result = useMemo(
    () => evaluateExpression(expr, { angleMode, ans, memory }),
    [expr, angleMode, ans, memory],
  );

  const insert = (text: string) => setExpr((prev) => prev + text);
  const backspace = () => setExpr((prev) => prev.slice(0, -1));
  const clear = () => setExpr('');

  const commit = () => {
    if (!result.ok) return;
    setAns(result.value);
    setExpr(result.display);
  };

  type KeyVariant = 'digit' | 'fn' | 'op' | 'accent' | 'muted';

  const keyBg: Record<KeyVariant, string> = {
    digit: surface.sunken,
    fn: surface.surface,
    op: palette.skyDim,
    accent: palette.sky,
    muted: surface.sunken,
  };
  const keyColor: Record<KeyVariant, string> = {
    digit: surface.text,
    fn: surface.muted,
    op: palette.sky,
    accent: palette.white,
    muted: surface.muted,
  };

  function Key({
    label,
    onPress,
    variant = 'digit',
    wide,
  }: {
    label: string;
    onPress: () => void;
    variant?: KeyVariant;
    wide?: boolean;
  }) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          styles.key,
          wide && styles.keyWide,
          {
            backgroundColor: keyBg[variant],
            borderColor: surface.border,
            opacity: pressed ? 0.7 : 1,
          },
        ]}
      >
        <Text style={[styles.keyLabel, { color: keyColor[variant] }]}>{label}</Text>
      </Pressable>
    );
  }

  const FN_KEYS: [string, string][] = [
    ['sin(', 'sin('], ['cos(', 'cos('], ['tan(', 'tan('],
    ['asin(', 'asin('], ['acos(', 'acos('], ['atan(', 'atan('],
    ['ln(', 'ln('], ['log10(', 'log10('], ['sqrt(', 'sqrt('],
    ['^', '^'], ['(', '('], [')', ')'],
    ['pi', 'pi'], ['e', 'e'], ['!', '!'],
  ];

  const showResult = result.ok || expr.trim() !== '';

  return (
    <View style={styles.tabGap}>
      {/* Display */}
      <View style={[styles.calcDisplay, { backgroundColor: surface.sunken, borderColor: surface.border }]}>
        <TextInput
          style={[styles.calcExprInput, { color: surface.text }]}
          value={expr}
          onChangeText={setExpr}
          placeholder="Expression, e.g. sqrt(2) * sin(45)"
          placeholderTextColor={surface.placeholder}
          autoCorrect={false}
          autoCapitalize="none"
          multiline={false}
          onSubmitEditing={commit}
          returnKeyType="done"
        />
        <Text style={[styles.calcResult, { color: result.ok ? surface.text : surface.muted }]}>
          {result.ok
            ? `= ${result.display}`
            : showResult
            ? '='
            : '0'}
        </Text>
      </View>

      {/* Angle mode + memory */}
      <View style={styles.row}>
        <View style={[styles.anglePill, { borderColor: surface.border, backgroundColor: surface.sunken }]}>
          {(['rad', 'deg'] as AngleMode[]).map((m) => (
            <Pressable
              key={m}
              onPress={() => setAngleMode(m)}
              style={[
                styles.angleBtn,
                {
                  backgroundColor: m === angleMode ? palette.sky : 'transparent',
                  borderRadius: radii.sm,
                },
              ]}
            >
              <Text style={[styles.angleBtnLabel, { color: m === angleMode ? palette.white : surface.muted }]}>
                {m.toUpperCase()}
              </Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.memRow}>
          <Text style={[styles.hint, { color: surface.muted }]}>M={formatResult(memory)}</Text>
          {(
            [
              ['MC', () => setMemory(0)],
              ['MR', () => insert('M')],
              ['M+', () => { if (result.ok) setMemory((v) => v + result.value); }],
            ] as [string, () => void][]
          ).map(([label, onPress]) => (
            <Pressable
              key={label}
              onPress={onPress}
              style={[styles.memBtn, { backgroundColor: surface.sunken, borderColor: surface.border }]}
            >
              <Text style={[styles.memBtnLabel, { color: surface.muted }]}>{label}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      {/* Keypad: function grid (left, 3-col) + number pad (right, 4-col) */}
      <View style={styles.keypadWrap}>
        <View style={styles.fnGrid}>
          {FN_KEYS.map(([label, text]) => (
            <Key key={label} label={label} onPress={() => insert(text)} variant="fn" />
          ))}
        </View>

        <View style={styles.numGrid}>
          <Key label="AC" onPress={clear} variant="muted" />
          <Key label="<-" onPress={backspace} variant="muted" />
          <Key label="Ans" onPress={() => insert('Ans')} variant="muted" />
          <Key label="/" onPress={() => insert('/')} variant="op" />

          <Key label="7" onPress={() => insert('7')} />
          <Key label="8" onPress={() => insert('8')} />
          <Key label="9" onPress={() => insert('9')} />
          <Key label="x" onPress={() => insert('*')} variant="op" />

          <Key label="4" onPress={() => insert('4')} />
          <Key label="5" onPress={() => insert('5')} />
          <Key label="6" onPress={() => insert('6')} />
          <Key label="-" onPress={() => insert('-')} variant="op" />

          <Key label="1" onPress={() => insert('1')} />
          <Key label="2" onPress={() => insert('2')} />
          <Key label="3" onPress={() => insert('3')} />
          <Key label="+" onPress={() => insert('+')} variant="op" />

          <Key label="0" onPress={() => insert('0')} wide />
          <Key label="." onPress={() => insert('.')} />
          <Key label="=" onPress={commit} variant="accent" />
        </View>
      </View>

      <HintText>
        Computed live as you type. sin/cos/tan/asin/acos/atan, ln, log10, sqrt, ^, !, pi, e. Nothing is saved.
      </HintText>
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

  return (
    <View style={styles.tabGap}>
      <HintText>
        n = m / MW, C = n / V. Enter MW plus target concentration and volume to get the mass to weigh out. Or enter a mass to get moles and concentration.
      </HintText>
      <PlainNumeric label="Molecular weight (g/mol)" value={mw} onValue={setMw} placeholder="e.g. 58.44" />
      <NumericWithUnit label="Target concentration" value={conc} onValue={setConc} unit={concU} onUnit={setConcU} units={CONC_UNITS} />
      <NumericWithUnit label="Volume" value={vol} onValue={setVol} unit={volU} onUnit={setVolU} units={VOL_UNITS} />
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

  return (
    <View style={styles.tabGap}>
      <HintText>
        C1 V1 = C2 V2. Enter stock concentration, the final concentration, and the final volume. Solves for how much stock to add.
      </HintText>
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

  return (
    <View style={styles.tabGap}>
      <HintText>
        Each tube takes a fixed transfer from the previous tube and tops up with diluent, giving an equal fold dilution per step.
      </HintText>
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

  return (
    <View style={styles.tabGap}>
      <HintText>
        Volume of stock = (final conc x total volume) / stock conc. The leftover is your diluent.
      </HintText>
      <NumericWithUnit label="Total volume" value={total} onValue={setTotal} unit={totalU} onUnit={setTotalU} units={VOL_UNITS} />

      {rows.map((r) => (
        <Card key={r.id} compact>
          <View style={styles.row}>
            <TextInput
              style={[styles.nameInput, { borderColor: surface.border, color: surface.text, flex: 1 }]}
              value={r.name}
              onChangeText={(v) => update(r.id, { name: v })}
              placeholder="Component name"
              placeholderTextColor={surface.placeholder}
              autoCorrect={false}
            />
            {rows.length > 1 ? (
              <Pressable
                onPress={() => remove(r.id)}
                style={[styles.removeBtn, { backgroundColor: palette.dangerLight, borderRadius: radii.sm }]}
              >
                <Text style={{ color: palette.danger, fontWeight: '700', fontSize: 13 }}>X</Text>
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
        style={[styles.addBtn, { borderColor: palette.skyBorder, backgroundColor: palette.skyDim, borderRadius: radii.md }]}
      >
        <Text style={[styles.addBtnLabel, { color: palette.sky }]}>+ Add component</Text>
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
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  fill: { flex: 1 },
  chipScroll: {
    maxHeight: 52,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  chipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
  },
  chipLabel: {
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  },
  body: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    gap: spacing.lg,
  },
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
  removeBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Scientific calculator keys
  calcDisplay: {
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: 4,
  },
  calcExprInput: {
    fontSize: 17,
    fontFamily: 'Courier',
    minHeight: 28,
  },
  calcResult: {
    fontSize: 26,
    fontWeight: '600',
    textAlign: 'right',
    letterSpacing: -0.5,
  },
  anglePill: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: radii.sm,
    overflow: 'hidden',
  },
  angleBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  angleBtnLabel: { fontSize: 13, fontWeight: '700' },
  memRow: { flexDirection: 'row', alignItems: 'center', gap: 4, flex: 1, justifyContent: 'flex-end' },
  memBtn: {
    borderWidth: 1,
    borderRadius: radii.sm,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  memBtnLabel: { fontSize: 12, fontWeight: '600' },
  keypadWrap: { flexDirection: 'row', gap: spacing.sm },
  fnGrid: {
    flex: 3,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  numGrid: {
    flex: 4,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  key: {
    width: '23%',
    aspectRatio: 1.2,
    borderRadius: radii.sm,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyWide: {
    width: '48%',
  },
  keyLabel: { fontSize: 12, fontWeight: '600' },
});
