// App entry route. The Home tab was retired in the 5-tab restructure, which left
// "/" with no route, the app launches at "/" and would otherwise hang on the
// splash with nowhere to go. This redirects the entry to the Today tab, the
// default landing surface. House style: no em-dashes, no emojis, no mid-sentence
// colons.
import { Redirect } from 'expo-router';

export default function Index() {
  return <Redirect href="/today" />;
}
