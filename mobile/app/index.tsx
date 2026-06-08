// App entry route. Redirects the entry point to the Notebook tab, the default
// landing surface after the tab restructure (Notebook replaced Today + Send).
// Without this file "/" has no route and the app hangs on the splash screen.
// House style: no em-dashes, no emojis, no mid-sentence colons.
import { Redirect } from 'expo-router';

export default function Index() {
  return <Redirect href="/notebook" />;
}
