/// <reference lib="deno.ns" />

export type NewsletterTemplateVars = {
  title: string;
  date: string;
  summary: string;
  body_html: string;
  permalink: string;
  unsubscribe_url: string;
  recipient_name: string;
};

export function changelogEmailTemplate(): string {
  return `<!DOCTYPE html>
<html lang="en" style="margin:0;padding:0;">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta name="x-apple-disable-message-reformatting" />
  <meta name="color-scheme" content="light only" />
  <meta name="supported-color-schemes" content="light only" />
  <title>{{ title }} — Overlord changelog</title>

  <!--[if mso]>
  <style>
    * { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif !important; }
  </style>
  <![endif]-->
  <style>
    @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Space+Grotesk:wght@400;500;600;700&display=swap');

    body, table, td, a { -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
    table, td { mso-table-lspace:0pt; mso-table-rspace:0pt; }
    img { -ms-interpolation-mode:bicubic; border:0; outline:none; text-decoration:none; }
    body { margin:0 !important; padding:0 !important; width:100% !important; }
    a { color:#1c1917; }
    a.cta:hover { background:#000 !important; }
    a.text-link:hover { text-decoration:underline !important; }

    .changelog-body { font-family:'Space Grotesk','Helvetica Neue',Helvetica,Arial,sans-serif; color:#1c1917; font-size:16px; line-height:1.6; }
    .changelog-body > *:first-child { margin-top:0 !important; }
    .changelog-body > *:last-child  { margin-bottom:0 !important; }

    .changelog-body h1,
    .changelog-body h2,
    .changelog-body h3,
    .changelog-body h4 {
      font-family:'Space Grotesk','Helvetica Neue',Helvetica,Arial,sans-serif;
      color:#1c1917;
      letter-spacing:-0.01em;
      margin:32px 0 14px;
    }
    .changelog-body h1 { font-size:24px; font-weight:600; }
    .changelog-body h2 { font-size:20px; font-weight:600; }

    .changelog-body h3 {
      font-family:'IBM Plex Mono','SF Mono',Menlo,Consolas,monospace;
      font-size:11px;
      font-weight:500;
      letter-spacing:0.22em;
      text-transform:uppercase;
      color:#a8a29e;
      margin:36px 0 14px;
      padding-bottom:10px;
      border-bottom:1px solid #e7e5e0;
    }
    .changelog-body h3:first-child { margin-top:0; }
    .changelog-body h4 { font-size:16px; font-weight:600; }

    .changelog-body p { margin:0 0 14px; color:#57534e; }
    .changelog-body strong { color:#1c1917; font-weight:600; }
    .changelog-body em { font-style:italic; }

    .changelog-body ul,
    .changelog-body ol { margin:0 0 18px; padding:0; list-style:none; }
    .changelog-body li {
      position:relative;
      padding:10px 0 10px 22px;
      border-bottom:1px solid #f1efe9;
      color:#57534e;
    }
    .changelog-body li:last-child { border-bottom:none; }
    .changelog-body li::before {
      content:"";
      position:absolute;
      left:4px;
      top:18px;
      width:6px;
      height:6px;
      border-radius:50%;
      background:#1c1917;
    }
    .changelog-body li strong:first-child { display:inline; color:#1c1917; }

    .changelog-body a {
      color:#1c1917;
      text-decoration:none;
      border-bottom:1px solid #d6d3ce;
    }
    .changelog-body a:hover { border-bottom-color:#1c1917; }

    .changelog-body code {
      font-family:'IBM Plex Mono','SF Mono',Menlo,Consolas,monospace;
      font-size:0.92em;
      background:#f4f3ee;
      border:1px solid #e7e5e0;
      border-radius:4px;
      padding:1px 6px;
      color:#1c1917;
    }
    .changelog-body pre {
      font-family:'IBM Plex Mono','SF Mono',Menlo,Consolas,monospace;
      font-size:13px;
      background:#f4f3ee;
      border:1px solid #e7e5e0;
      border-radius:8px;
      padding:14px 16px;
      margin:0 0 16px;
      overflow-x:auto;
      line-height:1.55;
      color:#1c1917;
    }
    .changelog-body pre code { background:transparent; border:none; padding:0; }
    .changelog-body blockquote {
      margin:0 0 16px;
      padding:6px 0 6px 16px;
      border-left:3px solid #e7e5e0;
      color:#57534e;
      font-style:normal;
    }
    .changelog-body hr {
      border:none;
      border-top:1px solid #e7e5e0;
      margin:28px 0;
    }
    .changelog-body img { max-width:100%; height:auto; border-radius:10px; margin:8px 0; }

    @media only screen and (max-width:620px) {
      .outer-td { padding:20px 8px 4px !important; }
      .container { width:100% !important; padding-left:10px !important; padding-right:10px !important; }
      .card { padding:24px 18px !important; border-radius:16px !important; }
      .hero-title { font-size:28px !important; line-height:1.1 !important; }
      .footer { padding:20px 14px 28px !important; }
      .changelog-body h3 { margin-top:28px; }
      .changelog-body li { padding-left:20px; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:#f6f4ef;font-family:'Space Grotesk','Helvetica Neue',Helvetica,Arial,sans-serif;color:#1c1917;">

  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#f6f4ef;">
    {{ summary }}
  </div>

  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f6f4ef;">
    <tr>
      <td align="center" class="outer-td" style="padding:32px 16px 8px;">

        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="640" class="container" style="max-width:640px;width:100%;">
          <tr>
            <td align="left" style="padding:0 4px 24px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="vertical-align:middle;padding-right:12px;">
                    <a href="https://www.ovld.ai" style="text-decoration:none;">
                      <img src="https://zitmmhvbilhjjdwgxlfm.supabase.co/storage/v1/object/public/org-images/Overlord/256.png"
                           width="36" height="36" alt="Overlord"
                           style="display:block;width:36px;height:36px;border-radius:8px;" />
                    </a>
                  </td>
                  <td style="vertical-align:middle;font-family:'Space Grotesk','Helvetica Neue',Helvetica,Arial,sans-serif;font-weight:600;font-size:18px;letter-spacing:-0.02em;color:#1c1917;">
                    <a href="https://www.ovld.ai" style="color:#1c1917;text-decoration:none;">Overlord</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>

        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="640" class="container" style="max-width:640px;width:100%;">
          <tr>
            <td class="card" style="background:#ffffff;border:1px solid #e7e5e0;border-radius:20px;padding:44px 44px 40px;">

              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td style="font-family:'IBM Plex Mono','SF Mono',Menlo,Consolas,monospace;font-size:11px;font-weight:500;letter-spacing:0.22em;text-transform:uppercase;color:#a8a29e;padding:0 0 18px;">
                    CHANGELOG
                    <span style="color:#d6d3ce;margin:0 8px;">·</span>
                    <span style="color:#57534e;letter-spacing:0.18em;">{{ date }}</span>
                  </td>
                </tr>
              </table>

              <h1 class="hero-title" style="margin:0 0 12px;font-family:'Space Grotesk','Helvetica Neue',Helvetica,Arial,sans-serif;font-weight:600;font-size:34px;line-height:1.05;letter-spacing:-0.04em;color:#1c1917;">
                {{ title }}
              </h1>

              <p style="margin:0 0 28px;font-family:'Space Grotesk','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.55;color:#57534e;">
                {{ summary }}
              </p>

              <div style="height:1px;background:#e7e5e0;margin:0 0 28px;line-height:1px;font-size:0;">&nbsp;</div>

              <div class="changelog-body">
                {{{ body_html }}}
              </div>

              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:32px 0 4px;">
                <tr>
                  <td style="background:#1c1917;border-radius:9999px;">
                    <a class="cta" href="{{ permalink }}"
                       style="display:inline-block;padding:14px 28px;font-family:'Space Grotesk','Helvetica Neue',Helvetica,Arial,sans-serif;font-weight:600;font-size:15px;letter-spacing:-0.01em;color:#fafaf7;text-decoration:none;border-radius:9999px;">
                      Read on the changelog&nbsp;→
                    </a>
                  </td>
                </tr>
              </table>

              <div style="margin-top:24px;padding-top:24px;border-top:1px solid #e7e5e0;font-family:'Space Grotesk','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:13px;line-height:1.5;color:#a8a29e;">
                Button doesn't work? Paste this URL into your browser:<br/>
                <a class="text-link" href="{{ permalink }}" style="color:#57534e;word-break:break-all;text-decoration:underline;">{{ permalink }}</a>
              </div>

            </td>
          </tr>
        </table>

        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="640" class="container" style="max-width:640px;width:100%;">
          <tr>
            <td class="footer" align="left" style="padding:28px 4px 40px;font-family:'Space Grotesk','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:12px;line-height:1.6;color:#a8a29e;">
              <div style="margin-bottom:6px;">
                <a class="text-link" href="https://www.ovld.ai" style="color:#57534e;text-decoration:none;font-weight:500;">ovld.ai</a>
                &nbsp;·&nbsp; Agent work, organized.
              </div>
              <div style="margin-top:10px;color:#a8a29e;">
                You're receiving this because you subscribed to Overlord product updates.
                <a class="text-link" href="{{ unsubscribe_url }}" style="color:#57534e;text-decoration:underline;">Unsubscribe</a>
                &nbsp;·&nbsp;
                <a class="text-link" href="{{ permalink }}" style="color:#57534e;text-decoration:underline;">View in browser</a>
              </div>
            </td>
          </tr>
        </table>

      </td>
    </tr>
  </table>
</body>
</html>`;
}

function escapeHtmlAttributeSafe(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function fillTemplateTags(template: string, vars: NewsletterTemplateVars): string {
  const escaped = {
    title: escapeHtmlAttributeSafe(vars.title),
    date: escapeHtmlAttributeSafe(vars.date),
    summary: escapeHtmlAttributeSafe(vars.summary),
    body_html: vars.body_html,
    permalink: escapeHtmlAttributeSafe(vars.permalink),
    unsubscribe_url: escapeHtmlAttributeSafe(vars.unsubscribe_url),
    recipient_name: escapeHtmlAttributeSafe(vars.recipient_name)
  };

  return template
    .replace(/\{\{\{\s*body_html\s*\}\}\}/g, escaped.body_html)
    .replace(/\{\{\s*body_html\s*\}\}/g, escaped.body_html)
    .replace(/\{\{\s*title\s*\}\}/g, escaped.title)
    .replace(/\{\{\s*date\s*\}\}/g, escaped.date)
    .replace(/\{\{\s*summary\s*\}\}/g, escaped.summary)
    .replace(/\{\{\s*permalink\s*\}\}/g, escaped.permalink)
    .replace(/\{\{\s*unsubscribe_url\s*\}\}/g, escaped.unsubscribe_url)
    .replace(/\{\{\s*recipient_name\s*\}\}/g, escaped.recipient_name);
}

export function wrapInTemplate({
  html,
  subject,
  appUrl,
  previewText,
  unsubscribeUrl
}: {
  html: string;
  subject: string;
  appUrl: string;
  previewText?: string;
  unsubscribeUrl?: string;
}): string {
  const preview = previewText
    ? `<div style="display:none;max-height:0;overflow:hidden;">${previewText}&nbsp;</div>`
    : '';
  const unsubLink = unsubscribeUrl ?? `${appUrl}/settings`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  ${preview}
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
          <tr>
            <td style="background:#09090b;padding:24px 40px;">
              <span style="color:#ffffff;font-size:20px;font-weight:700;letter-spacing:-0.5px;">Overlord</span>
            </td>
          </tr>
          <tr>
            <td style="padding:40px;color:#18181b;font-size:15px;line-height:1.6;">
              ${html}
            </td>
          </tr>
          <tr>
            <td style="padding:24px 40px;background:#fafafa;border-top:1px solid #e4e4e7;text-align:center;">
              <p style="margin:0 0 8px;font-size:12px;color:#71717a;">
                You're receiving this because you signed up for Overlord.
              </p>
              <p style="margin:0;font-size:12px;color:#71717a;">
                To stop receiving these emails, you can
                <a href="${unsubLink}" style="color:#18181b;text-decoration:underline;">unsubscribe</a> at any time.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
