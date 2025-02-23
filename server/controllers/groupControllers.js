// TODO:
// Function to send group invites to users (only for owner/moderators)

const Group = require("../models/Group");
const User = require("../models/User");
const mongoose = require("mongoose");

/* Example form:
{
    "name": "Cool Group",
    "bio": "Description goes here lorem ipsum blah blah",
    "city": "Helsinki",
    "groupSize": 4
}
*/

// GET /api/groups
const getAllGroups = async (req, res) => {
    try {
        const groups = await Group.find()
        .select("-chatHistory -documents -events")
        .sort({ createdAt: -1 });
        res.status(200).json(groups);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// GET /api/groups/group/:groupId
const getGroupInformation = async (req, res) => {
    const groupId = req.params.groupId;

    if (!mongoose.Types.ObjectId.isValid(groupId)) {
        return res.status(400).json({ message: "Invalid group ID"} );
    }

    try {

        if (!groupId) {
            return res.status(400).json({ message: "Group ID is required"});
        }

        let query = Group.findById(groupId);
        
        // If user isn't logged in or a member of the group, exclude certain fields
        if (!req.user?.id || !(await Group.findOne({ _id: groupId, members: req.user.id }))) {
            query = query.select('-chatHistory -documents -events');
        }

        const group = await query;

        if (!group) {
            return res.status(404).json({ message: "Group not found" });
        }

        res.status(200).json(group);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// POST /api/groups
const createGroup = async (req, res) => {
    const userId = req.user.id;

    try {
        const user = await User.findById(userId);

        const {
            name,
            photo,
            bio,
            city,
            timePreference,
            location,
            groupSize,
            major,
            skillLevels
          } = req.body;

        const group = new Group({
            owner: req.user.id,
            members: [req.user.id],
            moderators: [req.user.id],
            information: {
                name,
                photo,
                bio,
                city,
                timePreference,
                location,
                groupSize,
                major,
                skillLevels
            },
            chatHistory: [],
            documents: [],
            events: []
        });

        // Add the group ID to the user's groupsJoined array
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        user.groupsJoined.push(group._id);
        await user.save();
        
        const newGroup = await group.save();

        res.status(201).json(newGroup);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
}

// PUT /api/groups/:groupId
const updateGroup = async (req, res) => {
    const groupId = req.params.groupId;
    const userId = req.user.id
    const updates = req.body;

    if (!mongoose.Types.ObjectId.isValid(groupId)) {
        return res.status(400).json({ message: "Invalid group ID"} );
    }

    if (!updates || Object.keys(updates).length === 0) {
        return res.status(400).json({ message: "No update data provided" });
    }

    try {
        const group = await Group.findById(groupId);

        if (!group) {
            return res.status(404).json({ message: "Group not found" });
        }

        if (userId !== group.owner.toString()) {
            return res.status(400).json({ message: "Only the group owner can edit group information!" })
        }

        if (updates.information) {
            updates.information = {
                ...group.information.toObject(),
                ...updates.information
            };
        }

        if (updates.settings) {
            updates.settings = {
                ...group.settings.toObject(),
                ...updates.settings
            };
        }

        const updatedGroup = await Group.findByIdAndUpdate(groupId, updates, {
            new: true,
            runValidators: true
        });

        res.status(200).json(updatedGroup);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
}

//PUT /api/groups/join/:groupId
const joinGroup = async (req, res) => {
    const userId = req.user.id;
    const groupId = req.params.groupId;

    if (!mongoose.Types.ObjectId.isValid(groupId)) {
        return res.status(400).json({ message: "Invalid group ID" });
    }

    try {
        let user, group;

        [user, group] = await Promise.all([
              User.findById(userId),
              Group.findById(groupId)]);

        if (!group || !user) {
            return res.status(404).json({
                message: user ? "Group not found" : "User not found"
            });
        }

        if (group.members.includes(userId)) {
            return res.status(400).json({ message: "This user is already a member!" });
        }

        if (group.members.length >= group.information.groupSize) {
            return res.status(400).json({ message: "Group is full!" });
        }

        if (group.settings.inviteOnly) {
            return res.status(403).json({
                message: "This group requires an invitation to join."
            });
        }

        group.members.push(userId);
        user.groupsJoined.push(groupId);
        await Promise.all([group.save(), user.save()]);

        res.status(200).json({ message: "Succesfully joined the group." });
        
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
}

//PUT /api/groups/leave/:groupId
const leaveGroup = async (req, res) => {
    const userId = req.user.id;
    const groupId = req.params.groupId;

    if (!mongoose.Types.ObjectId.isValid(groupId)) {
        return res.status(400).json({ message: "Invalid group ID" });
    }

    try {
        let user, group;

        [user, group] = await Promise.all([
              User.findById(userId),
              Group.findById(groupId)]);

        if (!group || !user) {
            return res.status(404).json({
                message: user ? "Group not found" : "User not found"
            });
        }

        // Check if current user is the group owner
        if (userId === group.owner.toString()) {
            return res.status(400).json({ message: "Please either delete the group, or make someone else the owner first." })
        }

        if (group.moderators.includes(userId)) {
            group.moderators.pull(userId);
        }

        group.members.pull(userId);
        user.groupsJoined.pull(groupId);
        await Promise.all([group.save(), user.save()]);

        res.status(200).json({ message: "Succesfully left the group." });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
}

// DELETE /api//groups/:groupId
const deleteGroup = async (req, res) => {
    const groupId = req.params.groupId;
    const userId = req.user.id;

    if (!mongoose.Types.ObjectId.isValid(groupId)) {
        return res.status(400).json({ message: "Invalid group ID" });
    }

    try {
        const group = await Group.findById(groupId);

        // Check if the current user is the owner of the group
        if (userId !== group.owner.toString()) {
            return res.status(400).json({ message: "Only the group owner can delete the group!" })
        }

        // Remove the group from all the members' groupsJoined arrays
        await Group.updateMany(
            {groupsJoined: groupId},
            {$pull: {groupsJoined: groupId}}
        );

        const deletedGroup = await Group.findOneAndDelete(groupId);

        if (deletedGroup) {
            res.status(204).json({ message: "Group deleted" });
        } else {
            res.status(404).json({ message: "Group not found" });
        }
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// PUT /api/groups/addMod/:groupId
const addModerator = async (req, res) => {
    const userId = req.user.id;
    const groupId = req.params.groupId;
    const moderatorId = req.body.userId;

    if (!mongoose.Types.ObjectId.isValid(groupId)) {
        return res.status(400).json({ message: "Invalid group ID" });
    }

    if (!moderatorId) {
        return res.status(400).json({ message: "No user provided" });
    }

    try {
        let moderator, group;

        [moderator, group] = await Promise.all([
            User.findById(moderatorId),
            Group.findById(groupId)
        ]);

        if (!group || !moderator) {
            return res.status(404).json({ 
                message: group ? "User not found" : "Group not found"
            });
        }

        // Check if current user is the group owner
        if (userId !== group.owner.toString()) {
            return res.status(400).json({ message: "Only the group owner can add moderators!" })
        }

        // Check if the given user ID is a member of the group
        if (!group.members.includes(moderatorId)) {
            return res.status(400).json({ message: "User needs to be a member of the group!" });
        }

        // Check if the given user ID is already a moderator
        if (group.moderators.includes(moderatorId)) {
            return res.status(400).json({ message: "This user is already a moderator!" });
        }

        group.moderators.push(moderatorId);
        await group.save();

        res.status(200).json({ message: "Succesfully added moderator!" });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
}

// PUT /api/groups/removeMod/:groupId
const removeModerator = async (req, res) => {
    const userId = req.user.id;
    const groupId = req.params.groupId;
    const moderatorId = req.body.userId;

    if (!mongoose.Types.ObjectId.isValid(groupId)) {
        return res.status(400).json({ message: "Invalid group ID" });
    }

    if (!moderatorId) {
        return res.status(400).json({ message: "No user provided" });
    }

    try {
        let moderator, group;

        [moderator, group] = await Promise.all([
            User.findById(moderatorId),
            Group.findById(groupId)
        ]);

        if (!group || !moderator) {
            return res.status(404).json({ 
                message: group ? "User not found" : "Group not found"
            });
        }

        // Check if the current user is the group owner
        if (userId !== group.owner.toString()) {
            return res.status(400).json({ message: "Only the group owner can remove moderators!" })
        }

        // Check if the given user ID is a moderator
        if (!group.moderators.includes(moderatorId)) {
            return res.status(400).json({ message: "This user is not a moderator!" });
        }

        // Check if the given user ID is the owenr
        if (moderatorId === group.owner.toString()) {
            return res.status(400).json({ message: "Group owner must be a moderator!" });
        }

        group.moderators.pull(moderatorId);
        await group.save();

        res.status(200).json({ message: "Successfully removed moderator." });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
}

// PUT /api/groups/owner/:groupId
const changeOwner = async (req, res) => {
    const userId = req.user.id;
    const groupId = req.params.groupId;
    const ownerId = req.body.userId;

    if (!mongoose.Types.ObjectId.isValid(groupId)) {
        return res.status(400).json({ message: "Invalid group ID" });
    }

    if (!ownerId) {
        return res.status(400).json({ message: "No user provided" });
    }

    try {
        let owner, group;

        [owner, group] = await Promise.all([
            User.findById(ownerId),
            Group.findById(groupId)
        ]);

        if (!group || !owner) {
            return res.status(404).json({
                message: group ? "User not found" : "Group not found"
            });
        }

        // Check if the current user is the group owner
        if (userId !== group.owner.toString()) {
            return res.status(400).json({ message: "Only the group owner can transfer ownership!" })
        }

        // Check if the given user ID is already the owner
        if (ownerId === group.owner.toString()) {
            return res.status(400).json({ message: "You are already the owner!" })
        }

        // Check if the given user ID is a member of the group
        if (!group.members.includes(ownerId)) {
            return res.status(400).json({ message: "User has to be a member of the group!" });
        }

        // Make the new owner a moderator if not already one
        if (!group.moderators.includes(ownerId)) {
            group.moderators.push(ownerId);
        }

        group.owner = ownerId;
        await group.save();

        res.status(200).json({ message: "Successfully changed group owner." });
    } catch (error) {
        return res.status(500).json({ message: error.message });
    }
}

// PUT /api/groups/kick/:groupId
const kickMember = async (req, res) => {
    const userId = req.user.id;
    const groupId = req.params.groupId;
    const memberId = req.body.userId;

    if (!mongoose.Types.ObjectId.isValid(groupId)) {
        return res.status(400).json({ message: "Invalid group ID" });
    }

    if (!memberId) {
        return res.status(400).json({ message: "No user provided" });
    }

    try {
        let member, group;

        [member, group] = await Promise.all([
            User.findById(memberId),
            Group.findById(groupId)
        ]);

        if (!group || !member) {
            return res.status(404).json({
                message: group ? "User not found" : "Group not found"
            });
        }

        // Check if current user is a moderator
        if (!group.moderators.includes(userId)) {
            return res.status(400).json({ message: "Only moderators can kick members!" });
        }

        // Check if given user ID is a member
        if (!group.members.includes(memberId)) {
            return res.status(400).json({ message: "That user is not a member of this group!" });
        }

        // Check if given user ID is the group owner
        if (memberId === group.owner.toString()) {
            return res.status(400).json({ message: "Can't kick the group owner!" });
        }

        // Check if given user ID is a moderator
        if (group.moderators.includes(memberId)) {
            // Check if current user is the group owner
            if (!userId === group.owner.toString()) {
                return res.status(400).json({ message: "Only the owner can kick moderators!" })
            }
            group.moderators.pull(memberId);
        }

        group.members.pull(memberId);
        member.groupsJoined.pull(groupId);
        await Promise.all([group.save(), member.save()]);

        return res.status(200).json({ message: "Member kicked succesfully." });
    } catch (error) {
        return res.status(500).json({ message: error.message });
    }
}

module.exports = {
    getAllGroups,
    getGroupInformation,
    createGroup,
    updateGroup,
    joinGroup,
    leaveGroup,
    deleteGroup,
    addModerator,
    removeModerator,
    changeOwner,
    kickMember
}