const express = require('express');
const router = express.Router();

/**
 * POST /api/discord/verify-member - Verificar roles del usuario en Discord
 */
router.post('/verify-member', async (req, res) => {
    console.log('📥 [Backend] Recibida petición POST /api/discord/verify-member');
    console.log('📋 [Backend] Body:', { userId: req.body.userId, hasAccessToken: !!req.body.accessToken });

    try {
        const { userId, accessToken } = req.body;

        // En el backend, las variables NO tienen prefijo VITE_
        const guildId = process.env.DISCORD_GUILD_ID;
        const botToken = process.env.DISCORD_BOT_TOKEN;

        console.log('🔑 [Backend] Variables:', {
            hasGuildId: !!guildId,
            hasBotToken: !!botToken,
            guildId: guildId
        });

        if (!botToken) {
            console.error('❌ [Backend] Bot token no configurado');
            return res.status(500).json({
                error: 'Bot token not configured',
                message: 'DISCORD_BOT_TOKEN is required in server environment variables'
            });
        }

        if (!userId || !guildId) {
            console.error('❌ [Backend] Parámetros faltantes:', { userId: !!userId, guildId: !!guildId });
            return res.status(400).json({
                error: 'Missing required parameters',
                message: 'userId and guildId are required'
            });
        }

        // Usar bot token para obtener información del miembro con roles
        console.log(`🔄 [Backend] Consultando Discord API: /guilds/${guildId}/members/${userId}`);
        const response = await fetch(
            `https://discord.com/api/v10/guilds/${guildId}/members/${userId}`,
            {
                headers: {
                    'Authorization': `Bot ${botToken}`,
                },
            }
        );

        console.log('📡 [Backend] Respuesta de Discord:', { status: response.status, ok: response.ok });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));

            if (response.status === 404) {
                console.warn('⚠️ [Backend] Discord devolvió 404. Posibles causas:');
                console.warn('   - El bot no está en el servidor');
                console.warn('   - El bot no tiene el intent "SERVER MEMBERS INTENT" habilitado');
                console.warn('   - El bot no tiene permisos para ver miembros');
                console.warn('   - El usuario realmente no está en el servidor');
                console.warn('   Error de Discord:', errorData);

                return res.status(404).json({
                    error: 'Member not found',
                    message: errorData.message || 'User is not a member of the guild or bot lacks permissions. Check: 1) Bot is in server, 2) SERVER MEMBERS INTENT is enabled, 3) Bot has permissions to view members',
                    discordError: errorData
                });
            }

            if (response.status === 403) {
                console.error('❌ [Backend] Bot no tiene permisos (403):', errorData);
                return res.status(403).json({
                    error: 'Bot lacks permissions',
                    message: 'The bot does not have permission to view server members. Check bot permissions and SERVER MEMBERS INTENT.',
                    discordError: errorData
                });
            }

            console.error('❌ [Backend] Error de Discord API:', { status: response.status, error: errorData });
            return res.status(response.status).json({
                error: 'Discord API error',
                message: errorData.message || 'Failed to fetch member information',
                status: response.status,
                discordError: errorData
            });
        }

        const memberData = await response.json();
        console.log('✅ [Backend] Miembro obtenido:', {
            id: memberData.user?.id,
            username: memberData.user?.username,
            rolesCount: (memberData.roles || []).length
        });

        res.json({
            success: true,
            member: {
                id: memberData.user?.id,
                username: memberData.user?.username,
                roles: memberData.roles || [],
            }
        });
    } catch (error) {
        console.error('Error verifying Discord member:', error);
        res.status(500).json({
            error: 'Internal server error',
            message: error.message || 'Failed to verify member'
        });
    }
});

module.exports = router;

