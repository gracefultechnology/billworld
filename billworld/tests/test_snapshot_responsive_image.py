import unittest
from billworld.build_public_snapshot import Snapshot
class ResponsiveImageTests(unittest.TestCase):
 def test_uses_captured_candidate_when_fallback_was_not_fetched(self):
  p=Snapshot('https://example.test/',{'https://example.test/logo-300.png':'/reference-pages/local/logo'},heading=None,behavior_script=None)
  p.feed('<img src="/logo.png" srcset="/logo-150.png 150w, /logo-300.png 300w" onload="bad()">')
  output=''.join(p.output)
  self.assertIn('src="/reference-pages/local/logo"',output)
  self.assertNotIn('onload',output);self.assertNotIn('srcset',output)
 def test_keeps_captured_source_and_never_fetches_uncaptured_candidates(self):
  for mapping,expected in [({'https://example.test/logo.png':'/local/logo'},'src="/local/logo"'),({},'data:image/svg+xml')]:
   p=Snapshot('https://example.test/',mapping,heading=None,behavior_script=None);p.feed('<img src="/logo.png" srcset="https://other.test/no.png 300w">');output=''.join(p.output)
   self.assertIn(expected,output);self.assertNotIn('src="https:',output)
