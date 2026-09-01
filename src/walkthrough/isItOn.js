// The walk through switch, asked of the real app.
//
// The decision itself is in onlyForUs.js, which imports nothing so a plain node
// test can check it. This half is the part that has to ask Expo where the app's
// settings are, and Expo cannot be loaded outside a phone.
import Constants from 'expo-constants';
import { switchedOn } from './onlyForUs';

/** True only when somebody has deliberately turned the walk through on. */
export function walkthroughIsOn() {
  let extra = null;
  try {
    extra = (Constants.expoConfig && Constants.expoConfig.extra) || null;
  } catch (e) {
    extra = null;
  }
  return switchedOn(typeof process !== 'undefined' ? process.env : null, extra);
}
