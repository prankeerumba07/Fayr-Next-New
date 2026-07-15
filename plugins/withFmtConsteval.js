// Config plugin: patch the generated iOS Podfile so fmt 11.0.2 (bundled with
// RN 0.81) builds under Xcode 26's clang, which rejects fmt's consteval path
// with "call to consteval function is not a constant expression".
//
// `expo prebuild` regenerates ios/Podfile from scratch, so the fix must live
// here (a config plugin) rather than as a hand edit that prebuild would wipe.
const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const MARKER = "Pods', 'fmt', 'include', 'fmt', 'base.h";

const SNIPPET = `
    # fmt 11.0.2 (bundled with RN 0.81) hits "call to consteval function is not a
    # constant expression" under Xcode 26's clang. fmt's base.h redefines
    # FMT_USE_CONSTEVAL unconditionally, so a -D flag can't override it; patch the
    # header so FMT_CONSTEVAL is a plain constexpr (still compile-time capable, but
    # no hard consteval error). Runs after the pod is laid down; re-applies each install.
    fmt_base = File.join(__dir__, 'Pods', 'fmt', 'include', 'fmt', 'base.h')
    if File.exist?(fmt_base)
      text = File.read(fmt_base)
      patched = text.gsub("#  define FMT_CONSTEVAL consteval\\n", "#  define FMT_CONSTEVAL constexpr\\n")
      if patched != text
        File.chmod(0644, fmt_base) rescue nil # pod sources are read-only
        File.write(fmt_base, patched)
      end
    end
`;

module.exports = function withFmtConsteval(config) {
  return withDangerousMod(config, [
    'ios',
    (cfg) => {
      const podfilePath = path.join(cfg.modRequest.platformProjectRoot, 'Podfile');
      let contents = fs.readFileSync(podfilePath, 'utf8');
      if (contents.includes(MARKER)) return cfg; // already patched

      // Insert just before the closing `end` of the post_install block, which
      // ends the `react_native_post_install(...)` call.
      const anchor = /(\)\s*\n)(\s*end\s*\nend\s*)$/;
      if (anchor.test(contents)) {
        contents = contents.replace(anchor, `$1${SNIPPET}$2`);
        fs.writeFileSync(podfilePath, contents, 'utf8');
      }
      return cfg;
    },
  ]);
};
