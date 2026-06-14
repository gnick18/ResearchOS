/**
 * Custom calculator viewer (Custom Calculator Builder Phase 3, 2026-06-10).
 *
 * The laptop auto-syncs the calculators the researcher can see (their own
 * custom calculators plus the lab-shared ones) over the sealed relay. This
 * screen fetches that snapshot, lists the calculators, and opens one into a
 * bench-friendly runner: typed inputs (number, replicate multi-field, dropdown)
 * recompute outputs + guidance live through the SAME ported engine the laptop
 * uses (lib/calculators/custom.ts), so the answer at the bench matches the desk.
 *
 * Read mode only: the builder stays on the laptop (same rationale as the
 * read-mode method viewer, editing at the bench risks divergent specs). Inputs
 * start from each field's saved default and can be tweaked for a quick what-if,
 * but the calculator definition itself is not editable here.
 *
 * The built-in bench calculators (Scientific, Molarity, ...) are untouched and
 * stay on the Calc tab; these synced custom ones live here, reachable from the
 * Calc tab only after pairing.
 *
 * House style: no em-dashes, no emojis, no mid-sentence colons.
 */
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ScreenFrame } from '@/components/ui/ScreenFrame';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { fonts, palette, radii, spacing, useTheme } from '@/lib/design';
import { usePairing } from '@/lib/pairing';
import { signWithDevice } from '@/lib/device-identity';
import {
  fetchCalculatorsSnapshot,
  type SnapshotCalculator,
} from '@/lib/snapshots';
import {
  evaluateCustomCalculator,
  deriveTableRows,
  formatCalcValue,
  type CustomCalculatorSpec,
  type CustomCalculatorInput,
  type CustomCalcInputValues,
} from '@/lib/calculators/custom';

// ── Spec coercion ─────────────────────────────────────────────────────────────
//
// The snapshot fields are all optional (an older laptop shape never crashes the
// screen). Coerce a synced calculator into a strict CustomCalculatorSpec the
// engine accepts, dropping malformed entries.

function toSpec(c: SnapshotCalculator): CustomCalculatorSpec {
  return {
    name: c.name ?? 'Calculator',
    description: c.description ?? '',
    ...(c.field ? { field: c.field } : {}),
    inputs: (c.inputs ?? [])
      .filter((i) => typeof i.key === 'string' && i.key !== '')
      .map((i) => ({
        key: i.key as string,
        type: (i.type ?? 'number') as CustomCalculatorInput['type'],
        label: i.label ?? (i.key as string),
        ...(i.unit ? { unit: i.unit } : {}),
        ...(i.default !== undefined ? { default: i.default } : {}),
        ...(i.options
          ? {
              options: i.options
                .filter((o) => o.value !== undefined)
                .map((o) => ({
                  label: o.label ?? String(o.value),
                  value: o.value as number | string,
                })),
            }
          : {}),
        ...(i.columns
          ? {
              columns: i.columns
                .filter((col) => typeof col.key === 'string' && col.key !== '')
                .map((col) => ({
                  key: col.key as string,
                  label: col.label ?? (col.key as string),
                  kind: (col.kind ?? 'input') as 'input' | 'computed',
                  ...(col.unit ? { unit: col.unit } : {}),
                  ...(col.expr ? { expr: col.expr } : {}),
                })),
            }
          : {}),
        ...(i.rows ? { rows: i.rows } : {}),
      })),
    steps: (c.steps ?? [])
      .filter((s) => typeof s.key === 'string')
      .map((s) => ({ key: s.key as string, expr: s.expr ?? '' })),
    conditionals: (c.conditionals ?? []).map((cd) => ({ expr: cd.expr ?? '' })),
    outputs: (c.outputs ?? []).map((o) => ({
      label: o.label ?? '',
      expr: o.expr ?? '',
      ...(o.unit ? { unit: o.unit } : {}),
      ...(o.format ? { format: o.format } : {}),
      ...(o.decimals !== undefined ? { decimals: o.decimals } : {}),
    })),
  };
}

// ── Initial values ────────────────────────────────────────────────────────────
//
// Seed the live input state from each field's saved default. A number input is
// a string (so the field can be cleared / typed); a replicate is a list of
// strings (one per box); a dropdown is the selected option value.

type InputState = Record<
  string,
  string | string[] | number | Record<string, number | string>[]
>;

function initialState(spec: CustomCalculatorSpec): InputState {
  const state: InputState = {};
  for (const input of spec.inputs) {
    if (input.type === 'replicate') {
      const def = Array.isArray(input.default) ? input.default : [];
      state[input.key] = def.length > 0 ? def.map((v) => String(v)) : [''];
    } else if (input.type === 'dropdown') {
      const value =
        input.default !== undefined && !Array.isArray(input.default)
          ? input.default
          : input.options && input.options.length > 0
            ? input.options[0].value
            : '';
      state[input.key] = value;
    } else if (input.type === 'table') {
      // Mobile renders a table read-only from its seed rows (full editing is a
      // laptop affordance, a follow-up here), so the state carries the seed
      // rows verbatim for the engine to derive computed columns from.
      state[input.key] = Array.isArray(input.rows)
        ? input.rows.map((r) => ({ ...r }))
        : [];
    } else {
      state[input.key] =
        typeof input.default === 'number' ? String(input.default) : '';
    }
  }
  return state;
}

/** Turn the live UI state into the engine's value map (string boxes -> numbers,
 *  replicate string lists -> number arrays, dropdown value passed through, a
 *  table forwarded as its row objects). */
function toEngineValues(
  spec: CustomCalculatorSpec,
  state: InputState,
): CustomCalcInputValues {
  const values: CustomCalcInputValues = {};
  for (const input of spec.inputs) {
    const raw = state[input.key];
    if (input.type === 'replicate') {
      const list = Array.isArray(raw) ? (raw as string[]) : [];
      values[input.key] = list
        .map((s) => Number(s))
        .filter((n) => Number.isFinite(n));
    } else if (input.type === 'dropdown') {
      values[input.key] = raw as number | string;
    } else if (input.type === 'table') {
      values[input.key] = Array.isArray(raw)
        ? (raw as Record<string, number | string>[])
        : [];
    } else {
      values[input.key] = typeof raw === 'string' ? raw : String(raw);
    }
  }
  return values;
}

// ── Input field renderers ──────────────────────────────────────────────────────

function FieldLabel({ children }: { children: string }) {
  const { surface } = useTheme();
  return <Text style={[styles.fieldLabel, { color: surface.muted }]}>{children}</Text>;
}

function NumberField({
  input,
  value,
  onChange,
}: {
  input: CustomCalculatorInput;
  value: string;
  onChange: (v: string) => void;
}) {
  const { surface } = useTheme();
  // Contract .unitsel: one bordered surface-2 container with a mono input and,
  // when the field carries a unit, a sky-tinted .udd unit pill (read-only here
  // since custom-calculator units are fixed by the laptop definition).
  return (
    <View style={styles.fieldWrap}>
      <FieldLabel>{input.label}</FieldLabel>
      <View style={[styles.unitsel, { backgroundColor: surface.surface2, borderColor: surface.borderStrong }]}>
        <TextInput
          style={[styles.unitselInput, { color: surface.text }]}
          value={value}
          onChangeText={onChange}
          keyboardType="decimal-pad"
          placeholder="0"
          placeholderTextColor={surface.faint}
          autoCorrect={false}
          autoCapitalize="none"
        />
        {input.unit ? (
          <View style={styles.unitRow}>
            <View style={[styles.udd, { backgroundColor: palette.skyDim }]}>
              <Text style={[styles.uddLabel, { color: palette.sky }]}>{input.unit}</Text>
            </View>
          </View>
        ) : null}
      </View>
    </View>
  );
}

function ReplicateField({
  input,
  values,
  onChange,
}: {
  input: CustomCalculatorInput;
  values: string[];
  onChange: (next: string[]) => void;
}) {
  const { surface } = useTheme();

  const setAt = (i: number, v: string) => {
    const next = [...values];
    next[i] = v;
    onChange(next);
  };
  const removeAt = (i: number) => {
    if (values.length <= 1) return;
    onChange(values.filter((_, idx) => idx !== i));
  };
  const add = () => onChange([...values, '']);

  return (
    <View style={styles.fieldWrap}>
      <FieldLabel>{input.unit ? `${input.label} (${input.unit})` : input.label}</FieldLabel>
      <View style={styles.repGrid}>
        {values.map((v, i) => (
          <View key={i} style={styles.repCell}>
            {/* Each replicate value is a mono .unitsel box, so a column of
                measurements lines up like the rest of the calculator I/O. */}
            <View style={[styles.repInput, { backgroundColor: surface.surface2, borderColor: surface.borderStrong }]}>
              <TextInput
                style={[styles.repInputField, { color: surface.text }]}
                value={v}
                onChangeText={(nv) => setAt(i, nv)}
                keyboardType="decimal-pad"
                placeholder="0"
                placeholderTextColor={surface.faint}
                autoCorrect={false}
                autoCapitalize="none"
              />
            </View>
            {values.length > 1 ? (
              <Pressable
                onPress={() => removeAt(i)}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel={`Remove value ${i + 1}`}
                style={({ pressed }) => [
                  styles.repRemove,
                  { backgroundColor: pressed ? palette.coral : palette.dangerLight, borderRadius: radii.sm },
                ]}
              >
                {({ pressed }) => (
                  <Text style={{ color: pressed ? palette.white : palette.danger, fontFamily: fonts.bold, fontSize: 15 }}>
                    &times;
                  </Text>
                )}
              </Pressable>
            ) : null}
          </View>
        ))}
      </View>
      <Pressable
        onPress={add}
        style={({ pressed }) => [
          styles.repAdd,
          {
            borderColor: pressed ? palette.sky : palette.skyBorder,
            backgroundColor: pressed ? palette.sky : palette.skyDim,
            borderRadius: radii.sm,
          },
        ]}
      >
        {({ pressed }) => (
          <Text style={[styles.repAddLabel, { color: pressed ? palette.white : palette.sky }]}>
            + Add value
          </Text>
        )}
      </Pressable>
    </View>
  );
}

function DropdownField({
  input,
  value,
  onChange,
}: {
  input: CustomCalculatorInput;
  value: number | string;
  onChange: (v: number | string) => void;
}) {
  const { surface } = useTheme();
  const options = input.options ?? [];
  return (
    <View style={styles.fieldWrap}>
      <FieldLabel>{input.label}</FieldLabel>
      <View style={styles.optionRow}>
        {options.map((opt, i) => {
          const active = opt.value === value;
          return (
            <Pressable
              key={i}
              onPress={() => onChange(opt.value)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              style={({ pressed }) => [
                styles.optionChip,
                {
                  backgroundColor: pressed || active ? palette.sky : surface.surface,
                  borderColor: pressed || active ? palette.sky : surface.border,
                },
              ]}
            >
              {({ pressed }) => (
                <Text
                  style={[
                    styles.optionLabel,
                    { color: pressed || active ? palette.white : surface.muted },
                  ]}
                >
                  {opt.label}
                </Text>
              )}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** Read-only table renderer (Phase 5). Full table editing is a laptop
 *  affordance; on the phone a table input shows its seed rows with computed
 *  columns derived, plus a one-line "best edited on the laptop" note. It never
 *  crashes a table-type calculator that syncs to the phone. */
function TableField({
  spec,
  values,
  input,
}: {
  spec: CustomCalculatorSpec;
  values: CustomCalcInputValues;
  input: CustomCalculatorInput;
}) {
  const { surface } = useTheme();
  const columns = input.columns ?? [];
  const rows = deriveTableRows(spec, values, input.key);
  return (
    <View style={styles.fieldWrap}>
      <FieldLabel>{input.unit ? `${input.label} (${input.unit})` : input.label}</FieldLabel>
      {/* Contract .dtable inside a card-tight surface: uppercase faint headers,
          hairline rows, numeric cells in mono and right-aligned. */}
      <View style={[styles.tableWrap, { borderColor: surface.border, backgroundColor: surface.surface }]}>
        <View style={[styles.tableHeadRow, { borderBottomColor: surface.border }]}>
          {columns.map((c) => (
            <Text
              key={c.key}
              style={[styles.tableHeadCell, { color: surface.faint }]}
              numberOfLines={1}
            >
              {c.unit ? `${c.label} (${c.unit})` : c.label}
            </Text>
          ))}
        </View>
        {rows.length === 0 ? (
          <Text style={[styles.tableEmpty, { color: surface.muted }]}>No rows.</Text>
        ) : (
          rows.map((row, ri) => (
            <View
              key={ri}
              style={[
                styles.tableBodyRow,
                ri < rows.length - 1 && { borderBottomColor: surface.hairline, borderBottomWidth: StyleSheet.hairlineWidth },
              ]}
            >
              {columns.map((c) => {
                const cell = row[c.key];
                const isNum = typeof cell === 'number';
                const text = isNum
                  ? formatCalcValue(cell)
                  : cell !== undefined && cell !== ''
                    ? String(cell)
                    : '—';
                return (
                  <Text
                    key={c.key}
                    style={[
                      styles.tableBodyCell,
                      isNum && styles.tableBodyCellNum,
                      { color: surface.text },
                    ]}
                    numberOfLines={1}
                  >
                    {text}
                  </Text>
                );
              })}
            </View>
          ))
        )}
      </View>
      <Text style={[styles.tableNote, { color: surface.muted }]}>
        Best edited on the laptop.
      </Text>
    </View>
  );
}

// ── Runner (detail) view ────────────────────────────────────────────────────────

function CalcRunner({ calc }: { calc: SnapshotCalculator }) {
  const { surface } = useTheme();
  const spec = useMemo(() => toSpec(calc), [calc]);
  const [state, setState] = useState<InputState>(() => initialState(spec));

  const engineValues = useMemo(
    () => toEngineValues(spec, state),
    [spec, state],
  );
  const result = useMemo(
    () => evaluateCustomCalculator(spec, engineValues),
    [spec, engineValues],
  );

  const setField = (key: string, value: string | string[] | number) =>
    setState((prev) => ({ ...prev, [key]: value }));

  return (
    <View style={styles.runnerGap}>
      <View>
        <ThemedText type="title" style={styles.calcName}>
          {calc.name ?? 'Calculator'}
        </ThemedText>
        {calc.isShared && calc.ownerLabel ? (
          <Text style={[styles.sharedBy, { color: palette.sky }]}>
            Shared by {calc.ownerLabel}
          </Text>
        ) : null}
        {calc.description ? (
          <Text style={[styles.calcDesc, { color: surface.muted }]}>{calc.description}</Text>
        ) : null}
      </View>

      {spec.inputs.map((input) => {
        if (input.type === 'table') {
          return (
            <TableField
              key={input.key}
              spec={spec}
              values={engineValues}
              input={input}
            />
          );
        }
        if (input.type === 'replicate') {
          const v = (state[input.key] as string[]) ?? [''];
          return (
            <ReplicateField
              key={input.key}
              input={input}
              values={v}
              onChange={(next) => setField(input.key, next)}
            />
          );
        }
        if (input.type === 'dropdown') {
          const v = state[input.key] as number | string;
          return (
            <DropdownField
              key={input.key}
              input={input}
              value={v}
              onChange={(nv) => setField(input.key, nv)}
            />
          );
        }
        return (
          <NumberField
            key={input.key}
            input={input}
            value={(state[input.key] as string) ?? ''}
            onChange={(nv) => setField(input.key, nv)}
          />
        );
      })}

      {/* Results (contract .resultcard: sky-dim, mono values, hairline rows) */}
      <Text style={[styles.resultLbl, { color: surface.faint }]}>Result</Text>
      <View style={[styles.resultCard, { backgroundColor: palette.skyDim, borderColor: palette.skyBorder }]}>
        {result.outputs.length === 0 ? (
          <Text style={[styles.resultEmptyText, { color: surface.muted }]}>
            This calculator has no outputs yet.
          </Text>
        ) : (
          result.outputs.map((o, i) => (
            <View
              key={i}
              style={[
                styles.resultRow,
                i > 0 && { borderTopWidth: 1, borderTopColor: palette.skyBorder },
              ]}
            >
              <Text style={[styles.resultLabel, { color: surface.muted }]}>{o.label}</Text>
              <Text style={[styles.resultValue, { color: surface.text }]}>
                {o.display}
                {o.unit ? ` ${o.unit}` : ''}
              </Text>
            </View>
          ))
        )}
      </View>

      {/* Guidance messages from the conditionals. */}
      {result.messages.map((m, i) => (
        <View
          key={i}
          style={[styles.guidance, { backgroundColor: palette.amberDim, borderColor: palette.amberBorder }]}
        >
          <View style={styles.guidanceBadge}>
            <Text style={styles.guidanceBadgeLabel}>f</Text>
          </View>
          <Text style={[styles.guidanceText, { color: surface.text }]}>{m}</Text>
        </View>
      ))}

      <Text style={[styles.readOnlyNote, { color: palette.faint }]}>
        Computed live as you type. Built on the laptop, read-only here.
      </Text>
    </View>
  );
}

// ── List + screen ────────────────────────────────────────────────────────────────

// Contract .row-list .lrow: a tinted thumbnail square (a "≡" calculator glyph),
// the name with a "N inputs" sub, and a chevron. The thumbnail tint rotates
// through the brand accents so a long list stays lively, matching the render's
// violet / sky / amber thumbs.
const THUMB_TINTS: { bg: string; fg: string }[] = [
  { bg: palette.violetDim, fg: palette.violet },
  { bg: palette.skyDim, fg: palette.sky },
  { bg: palette.amberDim, fg: palette.amber },
];

function inputCountLabel(calc: SnapshotCalculator): string {
  const n = (calc.inputs ?? []).filter((i) => typeof i.key === 'string' && i.key !== '').length;
  return n === 1 ? '1 input' : `${n} inputs`;
}

function CalcListRow({
  calc,
  index,
  onPress,
}: {
  calc: SnapshotCalculator;
  index: number;
  onPress: () => void;
}) {
  const { surface } = useTheme();
  const tint = THUMB_TINTS[index % THUMB_TINTS.length];
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.lrow,
        { backgroundColor: pressed ? surface.pressed : 'transparent' },
      ]}
    >
      <View style={[styles.thumb, { backgroundColor: tint.bg }]}>
        <Text style={[styles.thumbGlyph, { color: tint.fg }]}>{'≡'}</Text>
      </View>
      <View style={styles.lrowMain}>
        <View style={styles.lrowTitleRow}>
          <ThemedText style={[styles.listName, { color: surface.text }]} numberOfLines={1}>
            {calc.name ?? 'Calculator'}
          </ThemedText>
          {calc.isShared ? (
            <View style={[styles.sharedBadge, { backgroundColor: palette.skyDim, borderColor: palette.skyBorder }]}>
              <Text style={[styles.sharedBadgeLabel, { color: palette.sky }]}>Lab</Text>
            </View>
          ) : null}
        </View>
        <Text style={[styles.listSub, { color: surface.muted }]} numberOfLines={1}>
          {calc.field ? `${calc.field} · ${inputCountLabel(calc)}` : inputCountLabel(calc)}
        </Text>
        {calc.description ? (
          <Text style={[styles.listDesc, { color: surface.muted }]} numberOfLines={2}>
            {calc.description}
          </Text>
        ) : null}
      </View>
      <Text style={[styles.lrowChevron, { color: surface.faint }]}>{'›'}</Text>
    </Pressable>
  );
}

export default function CalcCustomScreen() {
  const { surface } = useTheme();
  const { pairing } = usePairing();

  const [calculators, setCalculators] = useState<SnapshotCalculator[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openUid, setOpenUid] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!pairing) {
      setCalculators([]);
      setLoaded(true);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await fetchCalculatorsSnapshot(pairing, signWithDevice);
      setCalculators(data?.calculators ?? []);
      setLoaded(true);
    } catch {
      setError('Could not sync. Pull down to try again.');
    } finally {
      setLoading(false);
    }
  }, [pairing]);

  // Reload on focus so a calculator just built (or shared) on the laptop shows
  // up when the researcher opens this screen.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const paired = !!pairing;
  const open = openUid ? calculators.find((c) => c.uid === openUid) ?? null : null;

  return (
    <ScreenFrame>
      {/* Chevron only; the large in-content title avoids a doubled header. */}
      <ScreenHeader />
      <ScrollView
        style={styles.fill}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={load} tintColor={surface.muted} />
        }
      >
        {open ? (
          // Detail (runner) view. Back arrow in the header returns to the list,
          // so a small in-content "All calculators" link mirrors it.
          <>
            <Pressable
              onPress={() => setOpenUid(null)}
              accessibilityRole="button"
              style={styles.backLink}
            >
              <Text style={[styles.backLinkLabel, { color: palette.sky }]}>
                {'←'} All calculators
              </Text>
            </Pressable>
            <CalcRunner calc={open} />
          </>
        ) : (
          <>
            <View style={styles.titleWrap}>
              <ThemedText style={[styles.kicker, { color: surface.muted }]}>
                Bench math
              </ThemedText>
              <ThemedText type="title">Lab calculators</ThemedText>
            </View>

            {/* Contract .callout: the "built on the laptop" framing in a sky
                callout instead of a plain paragraph. */}
            <View style={[styles.callout, { backgroundColor: palette.skyDim, borderColor: palette.skyBorder }]}>
              <Text style={[styles.calloutText, { color: surface.text }]}>
                <Text style={{ color: palette.sky, fontFamily: fonts.bold }}>Built on the laptop. </Text>
                The calculators you made, plus the ones your lab shares, ready to run at the bench.
              </Text>
            </View>

            {!paired ? (
              <Card>
                <Text style={[styles.cardHint, { color: surface.muted }]}>
                  Pair this phone from the home tab to run your lab calculators.
                </Text>
              </Card>
            ) : null}

            {error ? (
              <Text style={[styles.errorText, { color: palette.danger }]}>{error}</Text>
            ) : null}

            {paired && !loaded ? (
              <View style={styles.loadingWrap}>
                <ActivityIndicator color={surface.muted} />
              </View>
            ) : null}

            {paired && loaded && calculators.length === 0 ? (
              <EmptyState
                icon="calculator-outline"
                text="No custom calculators yet. Build one on the laptop and it syncs here automatically."
              />
            ) : null}

            {calculators.length > 0 ? (
              <Card compact style={styles.rowListCard}>
                {calculators.map((c, i) => (
                  <View
                    key={c.uid ?? i}
                    style={i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: surface.hairline }}
                  >
                    <CalcListRow
                      calc={c}
                      index={i}
                      onPress={() => setOpenUid(c.uid ?? String(i))}
                    />
                  </View>
                ))}
              </Card>
            ) : null}
          </>
        )}
      </ScrollView>
    </ScreenFrame>
  );
}

// ── Styles (sky #1AA0E6 primary, grouped-container look, matches calc.tsx) ──────

const styles = StyleSheet.create({
  fill: { flex: 1 },
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxl + 16,
    gap: spacing.md,
  },
  // List header (kicker + title, matching the Calc tab)
  titleWrap: { gap: 4, marginBottom: 2 },
  kicker: { fontSize: 12.5, fontFamily: fonts.semibold },
  cardHint: { fontSize: 14, lineHeight: 20, fontFamily: fonts.ui },
  errorText: { fontSize: 14, lineHeight: 20, fontFamily: fonts.medium },
  loadingWrap: { paddingVertical: 32, alignItems: 'center' },

  // Intro callout (contract .callout)
  callout: {
    borderWidth: 1,
    borderRadius: radii.md,
    paddingVertical: 13,
    paddingHorizontal: 15,
  },
  calloutText: { fontSize: 13, lineHeight: 20, fontFamily: fonts.ui },

  // List (contract .row-list .lrow inside one card-tight)
  rowListCard: { paddingVertical: 2, gap: 0 },
  lrow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingVertical: 11,
    paddingHorizontal: 2,
    borderRadius: radii.sm,
  },
  thumb: {
    width: 46,
    height: 46,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbGlyph: { fontSize: 22, fontFamily: fonts.bold, marginTop: -2 },
  lrowMain: { flex: 1, minWidth: 0, gap: 2 },
  lrowTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  listName: { fontSize: 14, fontFamily: fonts.semibold, flexShrink: 1 },
  listSub: { fontSize: 12, fontFamily: fonts.medium },
  listDesc: { fontSize: 12.5, lineHeight: 17, fontFamily: fonts.ui, marginTop: 1 },
  lrowChevron: { fontSize: 22, fontFamily: fonts.semibold },
  sharedBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radii.pill,
    borderWidth: 1,
  },
  sharedBadgeLabel: { fontSize: 11, fontFamily: fonts.bold },

  // Detail
  backLink: { paddingVertical: 4 },
  backLinkLabel: { fontSize: 14, fontFamily: fonts.semibold },
  runnerGap: { gap: spacing.md },
  calcName: { fontSize: 22 },
  sharedBy: { fontSize: 13, fontFamily: fonts.semibold, marginTop: 2 },
  calcDesc: { fontSize: 14, lineHeight: 20, fontFamily: fonts.ui, marginTop: 4 },

  // Inputs (contract .flbl + .unitsel)
  fieldWrap: { gap: 6 },
  fieldLabel: { fontSize: 12, fontFamily: fonts.semibold },
  unitsel: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: radii.md,
    paddingRight: 6,
    minHeight: 48,
  },
  unitselInput: {
    flex: 1,
    minWidth: 0,
    fontFamily: fonts.mono,
    fontSize: 16,
    paddingHorizontal: 13,
    paddingVertical: 12,
  },
  unitRow: { flexDirection: 'row', gap: 4, flexShrink: 0 },
  udd: {
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: radii.sm,
    minWidth: 34,
    alignItems: 'center',
  },
  uddLabel: { fontSize: 12.5, fontFamily: fonts.bold },

  // Table (contract .dtable)
  tableWrap: { borderWidth: 1, borderRadius: radii.md, overflow: 'hidden' },
  tableHeadRow: { flexDirection: 'row', paddingHorizontal: 10, paddingVertical: 8, borderBottomWidth: 1 },
  tableHeadCell: {
    flex: 1,
    fontSize: 10.5,
    fontFamily: fonts.bold,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    paddingRight: 6,
  },
  tableBodyRow: {
    flexDirection: 'row',
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  tableBodyCell: { flex: 1, fontSize: 13, fontFamily: fonts.ui, paddingRight: 6 },
  tableBodyCellNum: { fontFamily: fonts.mono, textAlign: 'right' },
  tableEmpty: { paddingHorizontal: 10, paddingVertical: 9, fontSize: 13, fontFamily: fonts.ui },
  tableNote: { fontSize: 11, fontFamily: fonts.ui, fontStyle: 'italic' },

  // Replicate (mono .unitsel boxes)
  repGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  repCell: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  repInput: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: radii.md,
    minHeight: 48,
    minWidth: 80,
  },
  repInputField: {
    flex: 1,
    minWidth: 0,
    fontFamily: fonts.mono,
    fontSize: 16,
    paddingHorizontal: 13,
    paddingVertical: 12,
    textAlign: 'center',
  },
  repRemove: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  repAdd: {
    paddingVertical: 9,
    paddingHorizontal: 13,
    alignSelf: 'flex-start',
    borderWidth: 1,
  },
  repAddLabel: { fontSize: 13, fontFamily: fonts.semibold },

  // Dropdown (contract .ch / .ch.on pills)
  optionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  optionChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radii.pill,
    borderWidth: 1,
  },
  optionLabel: { fontSize: 13, fontFamily: fonts.semibold },

  // Results (contract .resultcard + .rr / .rk / .rv)
  resultLbl: {
    fontSize: 12,
    fontFamily: fonts.bold,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginTop: 4,
    marginBottom: -4,
    marginLeft: 4,
  },
  resultCard: {
    borderWidth: 1,
    borderRadius: radii.md,
    paddingHorizontal: 16,
    paddingVertical: 2,
    marginTop: 2,
  },
  resultRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: spacing.md,
    paddingVertical: 11,
  },
  resultLabel: { fontSize: 13, lineHeight: 20, fontFamily: fonts.ui },
  resultValue: { fontSize: 17, fontFamily: fonts.monoSemibold, lineHeight: 22, textAlign: 'right' },
  resultEmptyText: { fontSize: 13, lineHeight: 20, fontFamily: fonts.ui, paddingVertical: 9 },

  // Guidance callout (contract .callout.amber with an "f" badge)
  guidance: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    borderWidth: 1,
    borderRadius: radii.md,
    paddingVertical: 13,
    paddingHorizontal: 14,
  },
  guidanceBadge: {
    width: 22,
    height: 22,
    borderRadius: 6,
    backgroundColor: palette.amber,
    alignItems: 'center',
    justifyContent: 'center',
  },
  guidanceBadgeLabel: { color: palette.white, fontSize: 14, fontFamily: fonts.extrabold, fontStyle: 'italic' },
  guidanceText: { flex: 1, fontSize: 13, lineHeight: 19, fontFamily: fonts.ui },

  readOnlyNote: { fontSize: 13, lineHeight: 18, fontFamily: fonts.ui },
});
