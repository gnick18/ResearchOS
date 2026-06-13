// App entry route. Redirects "/" to the Home hub, the anchor destination in the
// UI contract nav (Home / Notebook / Methods / Inventory + center Capture).
// Without this file "/" has no route and the app hangs on the splash screen.
// House style: no em-dashes, no emojis, no mid-sentence colons.
import { Redirect } from 'expo-router';

export default function Index() {
  return <Redirect href="/home" />;
}
