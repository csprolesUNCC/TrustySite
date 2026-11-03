import { Resend } from 'resend';
import connectToDatabase from '../../utils/connect.js';
import { newResetToken, hashResetToken } from '../../utils/reset-token.js';
import { countHit, clientIp } from '../../utils/rate-limit.js';

const resend = new Resend(process.env.RESEND_API_KEY);

const TOKEN_MS = 60 * 60 * 1000; // a reset link works for an hour
const RESEND_AFTER_MS = 60 * 1000; // at most one email a minute per account, so nobody can flood an inbox
const SENT = { message: 'If that email exists, a reset link has been sent.' };

// The link in the email points back at the site the request came to (the live site, a preview deployment or
// `vercel dev`), but only if that's one of ours: anything else gets the live site.
function siteOrigin(req) {
    const host = String(req.headers.host || '');
    if (/^localhost(:\d+)?$/.test(host)) return `http://${host}`;
    if (/^([a-z0-9-]+\.)*(trustydahorse\.com|vercel\.app)$/i.test(host)) return `https://${host}`;
    return 'https://trustydahorse.com';
}

export default async (req, res) => {
    if (req.method !== 'POST') return res.status(405).json({ message: 'Method Not Allowed' });

    try {
        const sent = req.body?.email;
        if (typeof sent !== 'string' || !sent.trim() || sent.length > 320) return res.status(400).json({ message: 'Email is required.' });
        const email = sent.trim().toLowerCase();

        if (await countHit(`reset:${clientIp(req)}`, 60 * 60 * 1000) > 10) {
            return res.status(429).json({ message: 'Too many reset requests. Try again in an hour.' });
        }

        const { db } = await connectToDatabase();
        const usersCollection = db.collection('users');

        const user = await usersCollection.findOne(
            { email },
            { collation: { locale: 'en', strength: 2 } }
        );

        // The same answer either way, so this can't be used to find out who has an account.
        if (!user) return res.status(200).json(SENT);
        if (typeof user.resetRequestedAt === 'number' && Date.now() - user.resetRequestedAt < RESEND_AFTER_MS) {
            return res.status(200).json(SENT);
        }

        const resetToken = newResetToken();
        const result = await usersCollection.updateOne(
            { _id: user._id },
            {
                // Only the hash is stored (utils/reset-token.js). resetToken: plain tokens from before that.
                $set: { resetTokenHash: hashResetToken(resetToken), resetTokenExpiry: Date.now() + TOKEN_MS, resetRequestedAt: Date.now() },
                $unset: { resetToken: '' }
            }
        );

        if (result.matchedCount === 0) {
            console.error('Reset token was not saved for user:', user._id);
            return res.status(500).json({ message: 'Internal Server Error' });
        }

        const resetLink = `${siteOrigin(req)}/pages/auth/reset-password.html?token=${resetToken}`;

        const { data, error } = await resend.emails.send({
            from: 'Support <support@trustydahorse.com>',
            to: [user.email],
            subject: 'Reset Your Password - Trusty da Horse',
            html: `
                <h3>Password Reset</h3>
                <p>Click the link below to set a new password:</p>
                <a href="${resetLink}">Reset Password</a>
                <p>This link expires in 1 hour.</p>
            `
        });

        if (error) {
            console.error('Resend API Error:', error);
            return res.status(500).json({ message: 'Error sending email.' });
        }

        console.log(`Reset email sent for user ${user._id} via Resend ID: ${data.id}`);
        res.status(200).json(SENT);

    } catch (error) {
        console.error('Request Reset Error:', error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
};
