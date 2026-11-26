import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useAuthColors } from '@/features/auth/use-auth-colors';

export function TaskButton({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const colors = useAuthColors();
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[styles.control, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      <Text style={{ color: disabled ? colors.muted : colors.text, fontWeight: '600' }}>
        {label}
      </Text>
    </Pressable>
  );
}

export function TaskField({
  label,
  value,
  onChangeText,
  multiline = false,
}: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  multiline?: boolean;
}) {
  const colors = useAuthColors();
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ color: colors.text }}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        multiline={multiline}
        style={[
          styles.control,
          { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  control: {
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    justifyContent: 'center',
  },
});
