(() => {
  const icons = [
    [['ya.ru', 'yandex.ru', 'yandex.com'], 'assets/yandex.svg'],
    [['mail.google.com'], 'assets/sites/gmail.svg'],
    [['google.com'], 'assets/google.svg'],
    [['youtube.com', 'youtu.be'], 'assets/sites/youtube.svg'],
    [['telegram.org', 't.me'], 'assets/sites/telegram.svg'],
    [['wikipedia.org'], 'assets/sites/wikipedia.svg'],
    [['github.com'], 'assets/sites/github.svg'],
    [['figma.com'], 'assets/sites/figma.svg'],
    [['notion.so', 'notion.site'], 'assets/sites/notion.svg'],
    [['twitch.tv'], 'assets/sites/twitch.svg'],
    [['vk.com', 'vk.ru'], 'assets/sites/vk.svg'],
    [['ozon.ru'], 'assets/sites/ozon.png'],
    [['reddit.com'], 'assets/sites/reddit.svg'],
    [['amazon.com'], 'assets/sites/amazon.ico']
  ];

  function get(site) {
    if (!site || site.icon !== 'auto' || site.favicon) return null;
    try {
      const url = new URL(site.url);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
      const host = url.hostname.toLowerCase();
      return icons.find(([domains]) => domains.some(domain => host === domain || host.endsWith(`.${domain}`)))?.[1] || null;
    } catch { return null; }
  }

  globalThis.tabloSiteIcons = Object.freeze({ get });
})();
