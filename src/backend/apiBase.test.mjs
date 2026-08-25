// Where the app looks for the backend.
//
// What this exists to stop, hit live: the API base was a WRITTEN-DOWN address
// (EXPO_PUBLIC_FAYR_API_BASE, else localhost). On a laptop whose address changes
// with every network — a dongle one hour, a phone hotspot the next — a written
// address is stale the moment the network moves, and the app reports "network
// request failed" with no hint that the address is the problem.
//
// Metro already knows the right host: the phone downloaded the JS bundle from it
// seconds earlier. So derive it instead of writing it down.

import { apiBaseFrom } from './apiBase.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS ' + m); } else { fail++; console.log('  FAIL ' + m); } };

const BUNDLE = (host) => `http://${host}/index.bundle?platform=ios&dev=true&minify=false`;

console.log('=== 1. the host the bundle came from IS the backend host ===');
{
  const r = apiBaseFrom({ scriptURL: BUNDLE('192.168.1.20:8081'), apiPort: 3000 });
  ok(r.base === 'http://192.168.1.20:3000', 'LAN address is reused with the API port');
  ok(r.source === 'metro', 'and it is reported as derived, not configured');
  ok(!r.warning, 'no warning needed — this is the normal case');

  // The case that actually broke: a phone hotspot hands out a different subnet.
  const hotspot = apiBaseFrom({ scriptURL: BUNDLE('172.20.10.2:8081'), apiPort: 3000 });
  ok(hotspot.base === 'http://172.20.10.2:3000', 'a hotspot address needs no edit anywhere');
}

console.log('\n=== 2. Metro port is replaced, never reused ===');
{
  for (const port of ['8081', '19000', '19001']) {
    const r = apiBaseFrom({ scriptURL: BUNDLE(`10.1.2.3:${port}`), apiPort: 3000 });
    ok(r.base === 'http://10.1.2.3:3000', `Metro on :${port} → API on :3000`);
  }
  const custom = apiBaseFrom({ scriptURL: BUNDLE('10.1.2.3:8081'), apiPort: 4000 });
  ok(custom.base === 'http://10.1.2.3:4000', 'the API port is configurable');
}

console.log('\n=== 3. an explicit address always wins (the tunnel escape hatch) ===');
{
  const r = apiBaseFrom({
    envBase: 'https://fayr-api.trycloudflare.com',
    scriptURL: BUNDLE('192.168.1.20:8081'),
    apiPort: 3000,
  });
  ok(r.base === 'https://fayr-api.trycloudflare.com', 'set address beats the derived one');
  ok(r.source === 'env', 'and says where it came from');

  ok(apiBaseFrom({ envBase: 'http://x.test:3000/', scriptURL: null }).base === 'http://x.test:3000',
    'a trailing slash is trimmed so paths do not double up');
  ok(apiBaseFrom({ envBase: '   ', scriptURL: BUNDLE('10.0.0.5:8081') }).source === 'metro',
    'a blank env value is ignored rather than used as an address');
}

console.log('\n=== 4. the simulator still works with nothing set ===');
{
  const r = apiBaseFrom({ scriptURL: BUNDLE('localhost:8081'), apiPort: 3000 });
  ok(r.base === 'http://localhost:3000', 'localhost Metro → localhost backend');
  ok(!r.warning, 'and that is not a problem worth warning about');
}

console.log('\n=== 5. a tunnel host is detected, NOT silently guessed at ===');
{
  // Expo tunnel mode serves the bundle from a public host. Port 3000 on that host
  // is NOT forwarded, so deriving it would produce an address that cannot work.
  const r = apiBaseFrom({ scriptURL: BUNDLE('xy-abc.exp.direct'), apiPort: 3000 });
  ok(r.source === 'unknown', 'it does not pretend it derived a working address');
  ok(!!r.warning, 'it warns instead of failing silently');
  ok(/EXPO_PUBLIC_FAYR_API_BASE/.test(r.warning), 'and names the variable that fixes it');
  ok(r.base === 'http://localhost:3000', 'falling back to localhost, which at least works on a simulator');
}

console.log('\n=== 6. nothing to go on ===');
{
  for (const scriptURL of [null, undefined, '', 'file:///var/containers/main.jsbundle', 'not a url']) {
    const r = apiBaseFrom({ scriptURL, apiPort: 3000 });
    ok(r.base === 'http://localhost:3000', `${String(scriptURL).slice(0, 24)} → localhost fallback`);
    ok(!!r.warning, '  and it says so rather than looking healthy');
  }
}

console.log('\n=== 7. it never returns something unusable ===');
{
  const inputs = [
    {}, { scriptURL: BUNDLE('192.168.1.20:8081') }, { envBase: 'http://a.b:1/' },
    { scriptURL: 'https://1.2.3.4:8081/x.bundle' }, { scriptURL: BUNDLE('[::1]:8081') },
  ];
  for (const i of inputs) {
    const r = apiBaseFrom(i);
    ok(/^https?:\/\/.+/.test(r.base) && !r.base.endsWith('/'),
      `always an absolute URL with no trailing slash: ${r.base}`);
  }
  // An https Metro means an https API host too — do not downgrade the scheme.
  ok(apiBaseFrom({ scriptURL: 'https://1.2.3.4:8081/x.bundle', apiPort: 3000 }).base
    === 'https://1.2.3.4:3000', 'the scheme is carried over, not hardcoded');
}


console.log('\n=== 8. Expo Go: the host comes from expo-constants, not NativeModules ===');
{
  // Why this exists: Expo Go always runs bridgeless (New Architecture), where
  // NativeModules.SourceCode is not available — it is a legacy bridge module under
  // specs_DEPRECATED. So scriptURL was always null on a real phone and the app fell
  // through to localhost. app.json's newArchEnabled:false governs DEV BUILDS only,
  // not Expo Go, which is why this was invisible on the simulator.
  const r = apiBaseFrom({ hostUri: '192.168.1.20:8081', apiPort: 3000 });
  ok(r.base === 'http://192.168.1.20:3000', 'hostUri gives the LAN address');
  ok(r.source === 'metro', 'reported as derived');
  ok(!r.warning, 'no warning — this is the normal case on a phone');

  const hotspot = apiBaseFrom({ hostUri: '172.20.10.2:8081', apiPort: 3000 });
  ok(hotspot.base === 'http://172.20.10.2:3000', 'a hotspot address needs no edit');

  // hostUri is documented as a string but the port is not guaranteed to be there.
  ok(apiBaseFrom({ hostUri: '192.168.1.20', apiPort: 3000 }).base === 'http://192.168.1.20:3000',
    'a hostUri with no port still works');

  ok(apiBaseFrom({ hostUri: 'localhost:8081', apiPort: 3000 }).base === 'http://localhost:3000',
    'localhost Metro still resolves to a localhost backend');
}

console.log('\n=== 9. experienceUrl is the documented fallback ===');
{
  const r = apiBaseFrom({ experienceUrl: 'exp://192.168.1.20:8081', apiPort: 3000 });
  ok(r.base === 'http://192.168.1.20:3000', 'the exp:// scheme is replaced with http');
  ok(r.source === 'metro', 'still counts as derived');

  // hostUri wins when both are present.
  const both = apiBaseFrom({
    hostUri: '10.0.0.5:8081', experienceUrl: 'exp://192.168.1.20:8081', apiPort: 3000,
  });
  ok(both.base === 'http://10.0.0.5:3000', 'hostUri is preferred over experienceUrl');
}

console.log('\n=== 10. a tunnel hostUri is still detected, never guessed at ===');
{
  for (const host of ['xy-abc.exp.direct', 'u-anon-fayr-8081.exp.direct:80']) {
    const r = apiBaseFrom({ hostUri: host, apiPort: 3000 });
    ok(r.source === 'unknown', `${host}: not treated as reachable`);
    ok(/EXPO_PUBLIC_FAYR_API_BASE/.test(r.warning || ''), '  and names the variable that fixes it');
  }
}

console.log('\n=== 11. precedence, and the dev-build path still works ===');
{
  ok(apiBaseFrom({
    envBase: 'https://api.example.test', hostUri: '192.168.1.20:8081',
  }).source === 'env', 'an explicit address still beats everything');

  // A dev build is NOT bridgeless here (newArchEnabled:false), so scriptURL still
  // works there and must keep working.
  const devBuild = apiBaseFrom({
    scriptURL: 'http://192.168.1.77:8081/index.bundle?platform=ios', apiPort: 3000,
  });
  ok(devBuild.base === 'http://192.168.1.77:3000', 'scriptURL still resolves when present');

  // hostUri wins over scriptURL: it is the supported route.
  ok(apiBaseFrom({
    hostUri: '10.0.0.9:8081', scriptURL: 'http://192.168.1.77:8081/index.bundle',
  }).base === 'http://10.0.0.9:3000', 'hostUri is preferred over scriptURL');

  // The exact reported failure: everything absent → localhost, and it SAYS so.
  const none = apiBaseFrom({ apiPort: 3000 });
  ok(none.base === 'http://localhost:3000', 'nothing to go on → localhost');
  ok(/EXPO_PUBLIC_FAYR_API_BASE/.test(none.warning || ''), '  with the fix named');
}

console.log('\n=== 12. junk inputs never produce a broken address ===');
{
  for (const hostUri of ['', '   ', null, undefined, 'not a host', ':::']) {
    const r = apiBaseFrom({ hostUri, apiPort: 3000 });
    ok(/^https?:\/\/.+/.test(r.base) && !r.base.endsWith('/'),
      `${JSON.stringify(hostUri)} → still a usable URL (${r.base})`);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
