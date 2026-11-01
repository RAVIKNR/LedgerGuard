const { prisma } = require('../config/db');

function getCurrentUser(req, res) {
    const {
        id, name, email, status, createdAt, updatedAt,
        phone, addressLine, city, region, postalCode, country
    } = req.user;
    res.json({
        user: {
            id, name, email, status, createdAt, updatedAt,
            profile: { phone, addressLine, city, region, postalCode, country }
        }
    });
}

async function updateCurrentUserProfile(req, res) {
    const { name, phone, addressLine, city, region, postalCode, country } = req.body;
    const profile = await prisma.user.update({
        where: { id: req.user.id },
        data: {
            name: name.trim(),
            phone: typeof phone === 'string' && phone.trim() ? phone.trim().replace(/[\s().-]/g, '').replace(/^00/, '+') : null,
            addressLine: addressLine.trim(),
            city: city.trim(),
            region: region.trim(),
            postalCode: postalCode.trim(),
            country: country.trim().toUpperCase()
        },
        select: {
            id: true,
            name: true,
            email: true,
            status: true,
            createdAt: true,
            updatedAt: true,
            phone: true,
            addressLine: true,
            city: true,
            region: true,
            postalCode: true,
            country: true
        }
    });
    res.json({
        user: {
            id: profile.id,
            name: profile.name,
            email: profile.email,
            status: profile.status,
            createdAt: profile.createdAt,
            updatedAt: profile.updatedAt,
            profile: {
                phone: profile.phone,
                addressLine: profile.addressLine,
                city: profile.city,
                region: profile.region,
                postalCode: profile.postalCode,
                country: profile.country
            }
        },
        message: 'Banking profile saved.'
    });
}

module.exports = { getCurrentUser, updateCurrentUserProfile };
