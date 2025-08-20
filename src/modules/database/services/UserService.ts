import bcrypt from 'bcryptjs';
import {AppDataSource} from '../dataSource';
import {generateUniqueToken} from '../../lib/util';
import {User} from '../entities/user/User';
import {Guest} from '../entities/user/Guest';
import {GuestLink} from '../entities/user/GuestLink';
import {Role} from '../entities/user/Role';
import {MoreThan} from "typeorm";

export async function registerUser(username: string, password: string, email: string) {
    const repo = AppDataSource.getRepository(User);
    const hashed = await bcrypt.hash(password, 10);

    const user = repo.create({username, password: hashed, email, isActive: false});
    const result = await repo.save(user);
    return result.id;
}

export async function getUserByUsername(username: string) {
    const repo = AppDataSource.getRepository(User);
    return await repo.findOne({
        where: {username},
        select: ['id', 'username', 'email', 'isActive']
    });
}

export async function verifyPassword(userId: number, plain: string) {
    const repo = AppDataSource.getRepository(User);
    const user = await repo.findOne({where: {id: userId}, select: ['password']});
    if (!user) return false;
    return bcrypt.compare(plain, user.password);
}

export async function generateActivationToken(username: string) {
    const repo = AppDataSource.getRepository(User);
    const token = generateUniqueToken();
    const expiration = new Date(Date.now() + 3600_000);
    await repo.update({username}, {
        activationToken: token,
        activationTokenExpiration: expiration
    });
    return token;
}

export async function verifyActivationToken(token: string) {
    const repo = AppDataSource.getRepository(User);
    return await repo.findOne({
        where: {
            activationToken: token,
            activationTokenExpiration: MoreThan(new Date())
        },
        select: ['id', 'username', 'email', 'isActive']
    });
}

export async function activateUser(username: string) {
    const repo = AppDataSource.getRepository(User);
    await repo.update({username}, {
        isActive: true,
        activationToken: null,
        activationTokenExpiration: null
    });
}

export async function generatePasswordResetToken(username: string) {
    const repo = AppDataSource.getRepository(User);
    const token = generateUniqueToken();
    const expiration = new Date(Date.now() + 3600_000);
    await repo.update({username}, {
        resetToken: token,
        resetTokenExpiration: expiration
    });
    return token;
}

export async function verifyPasswordResetToken(token: string) {
    const repo = AppDataSource.getRepository(User);
    return await repo.findOne({
        where: {
            resetToken: token,
            resetTokenExpiration: MoreThan(new Date())
        },
        select: ['id', 'username', 'email', 'isActive']
    });
}

export async function resetPassword(username: string, newPassword: string) {
    const repo = AppDataSource.getRepository(User);
    const hashed = await bcrypt.hash(newPassword, 10);
    await repo.update({username}, {
        password: hashed,
        resetToken: null,
        resetTokenExpiration: null
    });
}

// Guests

export async function createGuest(username: string, email: string | null = null) {
    const repo = AppDataSource.getRepository(Guest);
    const guest = repo.create({username, email});
    const result = await repo.save(guest);
    return result.id;
}

export async function createGuestLink(entityType: string, entityId: string, guestId: number) {
    const repo = AppDataSource.getRepository(GuestLink);
    const token = generateUniqueToken();
    const link = repo.create({guestId, entityType, entityId, token});
    await repo.save(link);
    return token;
}

export async function registerGuest(entityType: string, entityId: string, username: string, email: string) {
    const guestId = await createGuest(username, email);
    const token = await createGuestLink(entityType, entityId, guestId);
    return {guestId, token};
}

export async function getGuestByToken(token: string) {
    const repo = AppDataSource.getRepository(GuestLink);
    return await repo.createQueryBuilder('gl')
        .leftJoinAndSelect('gl.guest', 'g')
        .where('gl.token = :token', {token})
        .select([
            'g.id', 'g.username', 'g.email',
            'gl.entityType', 'gl.entityId'
        ])
        .limit(1)
        .getRawOne();
}

export async function getGuestInternal(guestId: number) {
    const repo = AppDataSource.getRepository(Guest);
    return await repo.findOne({
        where: {id: guestId},
        select: ['id', 'username', 'email']
    });
}

export async function getGuestLinkToken(entityType: string, entityId: string, guestId: number) {
    const repo = AppDataSource.getRepository(GuestLink);
    const link = await repo.findOne({
        where: {guestId, entityType, entityId},
        select: ['token']
    });
    return link?.token || null;
}

export async function getAllRoles() {
    const repo = AppDataSource.getRepository(Role);
    return await repo.find();
}
