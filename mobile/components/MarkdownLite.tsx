// MarkdownLite. A small, dependency-free markdown renderer for the read view of
// an experiment's Notes/Results on the phone. Handles the common bench-note
// subset: ATX headings (#, ##, ###), bullet lists (- / *), blank-line
// paragraphs, inline **bold** and `code`. Rich embeds (the markdown-embed-hybrid
// cards) are a later upgrade; this is the read seam they slot into.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.
import { Fragment } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTheme, fonts } from '@/lib/design';

type Token =
  | { kind: 'h1' | 'h2' | 'h3' | 'p'; text: string }
  | { kind: 'li'; text: string }
  | { kind: 'space' };

function tokenize(md: string): Token[] {
  const out: Token[] = [];
  for (const raw of md.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    if (line.trim().length === 0) {
      out.push({ kind: 'space' });
    } else if (line.startsWith('### ')) {
      out.push({ kind: 'h3', text: line.slice(4) });
    } else if (line.startsWith('## ')) {
      out.push({ kind: 'h2', text: line.slice(3) });
    } else if (line.startsWith('# ')) {
      out.push({ kind: 'h1', text: line.slice(2) });
    } else if (/^[-*]\s+/.test(line)) {
      out.push({ kind: 'li', text: line.replace(/^[-*]\s+/, '') });
    } else {
      out.push({ kind: 'p', text: line });
    }
  }
  return out;
}

/** Render inline **bold** and `code` spans inside one line. */
function Inline({ text, color }: { text: string; color: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter((p) => p.length > 0);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return (
            <ThemedText key={i} style={[styles.bold, { color }]}>
              {part.slice(2, -2)}
            </ThemedText>
          );
        }
        if (part.startsWith('`') && part.endsWith('`')) {
          return (
            <ThemedText key={i} style={[styles.code, { color }]}>
              {part.slice(1, -1)}
            </ThemedText>
          );
        }
        return <Fragment key={i}>{part}</Fragment>;
      })}
    </>
  );
}

export function MarkdownLite({ markdown }: { markdown: string }) {
  const { surface } = useTheme();
  const tokens = tokenize(markdown);
  return (
    <View>
      {tokens.map((t, i) => {
        if (t.kind === 'space') return <View key={i} style={styles.space} />;
        if (t.kind === 'h1') {
          return (
            <ThemedText key={i} style={[styles.h1, { color: surface.text }]}>
              <Inline text={t.text} color={surface.text} />
            </ThemedText>
          );
        }
        if (t.kind === 'h2') {
          return (
            <ThemedText key={i} style={[styles.h2, { color: surface.text }]}>
              <Inline text={t.text} color={surface.text} />
            </ThemedText>
          );
        }
        if (t.kind === 'h3') {
          return (
            <ThemedText key={i} style={[styles.h3, { color: surface.text }]}>
              <Inline text={t.text} color={surface.text} />
            </ThemedText>
          );
        }
        if (t.kind === 'li') {
          return (
            <View key={i} style={styles.liRow}>
              <ThemedText style={[styles.bullet, { color: surface.muted }]}>•</ThemedText>
              <ThemedText style={[styles.p, { color: surface.text }]}>
                <Inline text={t.text} color={surface.text} />
              </ThemedText>
            </View>
          );
        }
        return (
          <ThemedText key={i} style={[styles.p, { color: surface.text }]}>
            <Inline text={t.text} color={surface.text} />
          </ThemedText>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  space: { height: 8 },
  h1: { fontSize: 20, fontFamily: fonts.bold, fontWeight: '700', marginTop: 6, marginBottom: 2 },
  h2: { fontSize: 16, fontFamily: fonts.bold, fontWeight: '700', marginTop: 6, marginBottom: 2 },
  h3: { fontSize: 14, fontFamily: fonts.semibold, fontWeight: '600', marginTop: 4, marginBottom: 2 },
  p: { fontSize: 14, lineHeight: 21, fontFamily: fonts.medium, flexShrink: 1 },
  bold: { fontFamily: fonts.bold, fontWeight: '700' },
  code: { fontFamily: fonts.monoSemibold, fontSize: 13 },
  liRow: { flexDirection: 'row', gap: 8, paddingLeft: 4, marginVertical: 1 },
  bullet: { fontSize: 14, lineHeight: 21 },
});
