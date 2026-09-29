import type { PluginTheme } from "@getpaseo/plugin";
import { TextInput } from "@getpaseo/plugin/client/react-native";
import { useMemo, type ReactNode } from "react";
import { Pressable, Text, View, type TextInputProps } from "react-native";

export function useStyles(theme: PluginTheme, compact: boolean) {
  return useMemo(() => {
    const c = theme.colors;
    return {
      screen: { flex: 1, backgroundColor: c.surface0, padding: compact ? 12 : 20, gap: 12 },
      row: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8, flexWrap: "wrap" as const },
      card: { backgroundColor: c.surface1, borderRadius: 10, padding: 12, gap: 6, borderWidth: 1, borderColor: c.border },
      title: { color: c.foreground, fontSize: compact ? 18 : 22, fontWeight: "600" as const },
      text: { color: c.foreground, fontSize: 14, lineHeight: 20 },
      muted: { color: c.foregroundMuted, fontSize: 12 },
      mono: { color: c.foreground, fontSize: 13, lineHeight: 19, fontFamily: "Menlo" },
      input: {
        color: c.foreground,
        backgroundColor: c.surface2,
        borderColor: c.border,
        borderWidth: 1,
        borderRadius: 8,
        paddingHorizontal: 10,
        paddingVertical: 8,
        fontSize: 14,
      },
      button: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 8, backgroundColor: c.accent },
      buttonText: { color: c.accentForeground, fontWeight: "600" as const },
      ghost: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface1 },
      ghostText: { color: c.foreground },
      pill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, borderWidth: 1 },
      error: { color: c.statusDanger },
    };
  }, [theme, compact]);
}

type S = ReturnType<typeof useStyles>;

export function Button({ s, label, onPress, disabled, ghost }: { s: S; label: string; onPress: () => void; disabled?: boolean; ghost?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={disabled}
      style={[ghost ? s.ghost : s.button, disabled ? { opacity: 0.5 } : null]}
    >
      <Text style={ghost ? s.ghostText : s.buttonText}>{label}</Text>
    </Pressable>
  );
}

export function StatusPill({ theme, category, label }: { theme: PluginTheme; category: string; label: string }) {
  const c = theme.colors;
  const color = category === "done" ? c.statusSuccess : category === "indeterminate" ? c.statusWarning : c.foregroundMuted;
  return (
    <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, borderWidth: 1, borderColor: color }}>
      <Text style={{ color, fontSize: 11, fontWeight: "600" }}>{label}</Text>
    </View>
  );
}

export function Field({ s, label, children }: { s: S; label: string; children: ReactNode }) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={s.muted}>{label}</Text>
      {children}
    </View>
  );
}

export function Input({ s, ...props }: { s: S } & TextInputProps) {
  return <TextInput placeholderTextColor={s.muted.color} {...props} style={[s.input, props.multiline ? { minHeight: 96, textAlignVertical: "top" } : null, props.style]} />;
}
