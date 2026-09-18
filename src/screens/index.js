// THE ONE PLACE A DESIGN SCREEN IS LOOKED UP BY ITS OWN KEY.
//
// App.js registers everything in here that belongs in the navigator, and the
// first run sequence resolves the rest from the same map. One key, one file, one
// component, looked up in one place — so a screen cannot be registered twice
// under two names, and a screen cannot exist with nothing able to open it.
//
// The list of keys and where each one lives is in keys.js next door, which is
// plain data and is checked against fayr-design.browser.jsx by keys.test.mjs.
// That test also checks THIS file: every key that claims its own file must be
// mapped here, and nothing else may be.
import splash from './splash';
import forceupdate from './forceupdate';
import maintenance from './maintenance';
import onboard from './onboard';
import authlanding from './authlanding';
import truecaller from './truecaller';
import phone from './phone';
import otp from './otp';
import otplocked from './otplocked';
import blocked from './blocked';
import newdevice from './newdevice';
// The claim journey, split out of src/journey/JourneyScreen.js on 1 September
// 2026 — eleven design screens that were eleven pages inside one file. The
// journey's router resolves them from this map by the design's own key; App.js
// registers each of them under the same key so it is also a destination in its
// own right. See src/ui/journey.js for which step maps to which key.
import linkaccount from './linkaccount';
import buyinterstitial from './buyinterstitial';
import proofprimer from './proofprimer';
import underreview from './underreview';
import ocrconfirm from './ocrconfirm';
import delivery from './delivery';
import reviewguide from './reviewguide';
import reviewproof from './reviewproof';
import returnwindow from './returnwindow';
import reward from './reward';
// The five the buying journey was missing, built 1 September 2026. Two of them —
// emailconnect and emailcode — are drawn as the design draws them and say plainly
// on the screen that Fayr has nowhere to connect an inbox to yet.
import returncatch from './returncatch';
// THE SHOP INSIDE FAYR, as a step. Phase 7, 18 September 2026 — a door that
// records the consent and hands over to the Shop route. See src/screens/shop.js.
import shop from './shop';
import emailconnect from './emailconnect';
import emailcode from './emailcode';
import orderverified from './orderverified';
import imagesuploaded from './imagesuploaded';

/** Design key to the component that draws it. Nothing else belongs in here. */
export const SCREENS = {
  splash,
  forceupdate,
  maintenance,
  onboard,
  authlanding,
  truecaller,
  phone,
  otp,
  otplocked,
  blocked,
  newdevice,
  linkaccount,
  buyinterstitial,
  proofprimer,
  underreview,
  ocrconfirm,
  delivery,
  reviewguide,
  reviewproof,
  returnwindow,
  reward,
  returncatch,
  shop,
  emailconnect,
  emailcode,
  orderverified,
  imagesuploaded,
};

/** The component for one design key, or null when the key is not one of ours. */
export function screenFor(key) {
  return Object.prototype.hasOwnProperty.call(SCREENS, key) ? SCREENS[key] : null;
}
