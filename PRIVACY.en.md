# Tablo privacy policy

[Русский](PRIVACY.md)

For the source code of version 0.5.0, dated October 19, 2026.

## Local data

Tablo saves the addresses and names of your sites, tile order, folders, chosen colors, downloaded icons, appearance and language settings, custom background, selected city, and weather cache in your Firefox profile. The main store is `browser.storage.local`. Additional local caches in `localStorage` hold the background, search settings, tiles, weather, and language choice so the page can display them early. In automatic mode, the language is determined locally from Firefox's interface language.

The extension does not use `storage.sync` and contains no analytics, advertising, telemetry, or server of its own to receive this data. It does not read your browsing history or Firefox passwords.

## Weather

Weather requires separate permission from Firefox. Tablo does not determine your device's location: you choose a city manually. City search sends the name you enter and the interface language (`ru` or `en`) to `geocoding-api.open-meteo.com`. Forecast requests send the selected city's coordinates to the provider you choose: `api.open-meteo.com` for Open-Meteo or `api.met.no` for MET Norway. Switching providers requests Firefox permission for the new provider. Once enabled, weather updates while the page is running and uses a local cache between requests. No API keys or service accounts are required.

The selected service receives your IP address and the usual network connection metadata. Requests do not include cookies or a Referer header. MET Norway also receives the extension's name and version in the `User-Agent`, with no user identifier. External services handle information under the [Open-Meteo terms](https://open-meteo.com/en/terms) and [MET Norway terms](https://api.met.no/doc/TermsOfService).

In the Russian interface, the Yandex Weather link opens Yandex with the selected city's coordinates. In the English interface, “Open Google Weather” opens a Google search containing the selected city's name and the word “weather.” These links open only when clicked. Neither service supplies the forecast shown in the widget. After a link opens, that site's rules and your Firefox settings apply.

You can turn weather off in Tablo settings. You can revoke its permission in Firefox's extension settings.

## Site names and icons

Icons for the default sites are bundled with the extension and appear without network requests. When you add or edit a tile, or choose to load site icons, Tablo may request the site's page and icon addresses found on it. Firefox permission for the relevant address is required first. If the page or icon redirects to another domain, access to that domain is also checked and requested separately when needed.

The request goes to the site you entered or its icon server, including a third-party CDN if the site links to one. That server sees the requested URL, your IP address, and the usual network metadata. These requests do not include cookies or a Referer header. Retrieved names and processed icons are saved locally. Tablo does not use a central favicon lookup service.

The optional `webRequest` permission is used to read redirect headers for Tablo's own requests. The handler limits events by request address, tab, and extension page. It does not collect browsing history from other tabs.

## Search and opening sites

Submitting the search bar opens your selected engine—Google, Yandex, Bing, DuckDuckGo, Brave, or Ecosia—with your query. Entering an address or clicking a tile opens the corresponding site. Subsequent network activity on that page is governed by the site and your browser settings. The `credentials: omit` and `no-referrer` settings apply to weather and metadata requests, not to all subsequent browsing.

## Backups and removal

Export saves a JSON file on your device. It contains saved addresses, names, folders, appearance settings, and the selected city. Share that file only with people you want to disclose this data to. Import reads a file you select locally.

Remove individual tiles or change the city through Tablo's interface. To remove all extension data, remove the extension and its data through Firefox. You must delete separately saved JSON files yourself.
