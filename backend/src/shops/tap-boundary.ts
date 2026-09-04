/**
 * WHICH SHOPS FAYR OPENS BY TAPPING THEIR OWN SIGN IN CONTROL.
 *
 * A SECOND COPY OF A LIST THAT LIVES IN THE APP, and it is deliberate. The list
 * itself is in src/signinTap.js, which is app code our side cannot import: it is
 * plain JavaScript full of injected browser scripts. So this names the three
 * shops, and connect-words.spec.ts checks this list against that file's own
 * exported list by reading it from disk. If the two ever disagree, the check
 * fails and names the shop.
 *
 * WHY OUR SIDE CARES AT ALL. Because the tap is a deliberate reading of the
 * owner's rule that Fayr never taps a shop's sign in button, and a reading of a
 * rule about somebody's money should be written down where the rule is checked,
 * not only where the code is.
 */
export function shopsThatTapToSignIn(): string[] {
  return ['flipkart', 'zepto', 'blinkit'];
}
