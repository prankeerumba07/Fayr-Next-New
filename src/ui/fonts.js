// The font families the redesign uses, mapped to the ttf assets shipped by the
// @expo-google-fonts packages. App.js passes `fontMap` to expo-font's useFonts
// and gates first render until it resolves, so FONT.* families in theme.js are
// always available by the time a screen paints. Keys here MUST match the family
// names referenced in src/ui/theme.js.
import { Poppins_600SemiBold, Poppins_700Bold, Poppins_800ExtraBold } from '@expo-google-fonts/poppins';
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from '@expo-google-fonts/inter';
import { Alexandria_700Bold, Alexandria_800ExtraBold } from '@expo-google-fonts/alexandria';

export const fontMap = {
  Poppins_600SemiBold,
  Poppins_700Bold,
  Poppins_800ExtraBold,
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  Alexandria_700Bold,
  Alexandria_800ExtraBold,
};
