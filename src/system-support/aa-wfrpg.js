import { createActiveEffects } from "../active-effects/handleActiveEffects.js";
import { trafficCop }       from "../router/traffic-cop.js"
import AAHandler            from "../system-handlers/workflow-data.js";
import { debug }            from "../constants/constants.js";
import { getRequiredData }  from "./getRequiredData.js";

export function systemHooks() {
    Hooks.on("wfrp4e:rollWeaponTest", async (data, info) => {
        if (game.user.id !== info.user) { return }
        let compiledData = await getRequiredData({
            item: data.weapon,
            targets: compileTargets(data.context?.targets),
            tokenId: info.speaker?.token,
            actorId: info.speaker?.actor,
            workflow: data
        })
        compiledData.targets = data.context?.targets ? Array.from(data.context?.targets).map(token => canvas.tokens.get(token.token)) : [];
        runWarhammer(compiledData)
    });
    Hooks.on("wfrp4e:rollPrayerTest", async (data, info) => {
        if (data.result.outcome != "success" && game.settings.get('autoanimations', 'castOnlyOnSuccess')) { return }
        let compiledData = await getRequiredData({
            item: data.prayer,
            targets: compileTargets(data.context?.targets),
            tokenId: info.speaker?.token,
            actorId: info.speaker?.actor,
            workflow: data
        })
        runWarhammer(compiledData)
    });
    Hooks.on("wfrp4e:rollCastTest", async (data, info) => {
        if (game.user.id !== info.user) { return }
        if (data.result.castOutcome != "success" && game.settings.get('autoanimations', 'castOnlyOnSuccess')) { return }
        let compiledData = await getRequiredData({
            item: data.spell,
            targets: compileTargets(data.context?.targets),
            tokenId: info.speaker?.token,
            actorId: info.speaker?.actor,
            workflow: data
        })
        runWarhammer(compiledData)
    });

    Hooks.on("wfrp4e:applyDamage", async (scriptArgs) => {
        if (!game.user.isGM) { return }
        if (scriptArgs.opposedTest.attackerTest.result.castOutcome != "success" || !scriptArgs.opposedTest.attackerTest.spell?.system?.magicMissile?.value) { return }
        let compiledData = await getRequiredData({
            item: scriptArgs.opposedTest.attackerTest.spell,
            targets: game.canvas.tokens.getDocuments().filter(x=>x.actorId == scriptArgs.opposedTest.defenderTest.data.context.speaker.actor),
            tokenId: game.canvas.tokens.getDocuments().find(x=>x.actorId == scriptArgs.opposedTest.attackerTest.data.context.speaker.actor).id,
            actorId: scriptArgs.attacker.id,
            workflow: scriptArgs.opposedTest.attackerTest
        })
        runWarhammer(compiledData)
    });

    Hooks.on("wfrp4e:rollTraitTest", async (data, info) => {
        if (game.user.id !== info.user) { return }
        let compiledData = await getRequiredData({
            item: data.trait,
            targets: compileTargets(data.context?.targets),
            tokenId: info.speaker?.token,
            actorId: info.speaker?.actor,
            workflow: data
        })
        runWarhammer(compiledData)
    });
    Hooks.on("wfrp4e:rollTest", async (data, info) => {
        if (game.user.id !== info.user) { return }
        if (data.result.outcome != "success" && game.settings.get('autoanimations', 'castOnlyOnSuccess')) { return }
        if (!data.skill) { return }
        let compiledData = await getRequiredData({
            item: data.skill,
            targets: compileTargets(data.context?.targets),
            tokenId: info.speaker?.token,
            actorId: info.speaker?.actor,
            workflow: data
        })
        runWarhammer(compiledData)
    });
    
    Hooks.on("createMeasuredTemplate", async (template, data, userId) => {
        if (userId !== game.user.id) { return };
        if (template.flags?.wfrp4e?.itemuuid) {
            const uuid = template.flags.wfrp4e.itemuuid;
            templateAnimation(await getRequiredData({itemUuid: uuid, templateData: template, workflow: template, isTemplate: true}))
        } else if (template.flags?.wfrp4e?.effectData) {
            const item = await fromUuid(template.flags.wfrp4e.effectData.system.sourceData.item)
            const effect = item.effects.get(template.flags.wfrp4e.effectData._id);
            const templateObj = game.scenes.current.templates.get(template.id);
            templateAnimation(await getRequiredData({itemUuid: effect.parent.uuid, templateData: template, workflow: template, isTemplate: true}))
        } else if (template.flags?.wfrp4e?.auraToken) {
            const effectUuid = template.flags.wfrp4e.effectUuid;
            const effect = await fromUuid(effectUuid)
            templateAnimation(await getRequiredData({itemUuid: effect.parent.uuid, templateData: template, workflow: template, isTemplate: true}))
        }
    });

    Hooks.on("AutomatedAnimations-WorkflowStart", onWorkflowStart);
}

function onWorkflowStart(clonedData, animationData) {
    if (clonedData.activeEffect?.constructor.name == "Boolean" && clonedData.activeEffect && animationData) { // item is ActiveEffect
        let effect = clonedData.item;
        if (effect.flags?.wfrp4e.applicationData.type == "aura" && effect.flags.autoanimations?.activeEffectType == "aura") {
            let radius = clonedData.item.radius;
            animationData.primary.options.size = radius;
        }
        else if (effect.flags?.wfrp4e?.applicationData.type == "document" && effect.flags.wfrp4e.applicationData.targetedAura && effect.flags.autoanimations?.activeEffectType == "aura") {
            clonedData.stopWorkflow = true;
        }
    }
    else if (clonedData.activeEffect?.constructor.name == "EffectWfrp4e" && clonedData.activeEffect?.flags.wfrp4e.applicationData.type == "aura" && animationData) { // item is item. 
        if (clonedData.activeEffect.flags?.autoanimations.activeEffectType == "aura") {
            animationData.primary.options.size = clonedData.activeEffect.radius / 2;
        }
    }
}

async function runWarhammer(data) {
    if (!data.item) { return; }
    const handler = await AAHandler.make(data)
    trafficCop(handler);
}

function compileTargets(targets) {
    if (!targets) { return []; }
    return Array.from(targets).map(token => canvas.tokens.get(token.token));
}

async function templateAnimation(input) {
    debug("Template placed, checking for animations")
    if (!input.item) { 
        debug("No Item could be found")
        return;
    }
    const handler = await AAHandler.make(input)
    if (handler.templateData?.flags?.wfrp4e?.effectUuid && 
        handler.templateData?.flags?.wfrp4e?.auraToken && 
        handler.isAura &&
        handler.animationData?.primary?.options) {
            const effect = await fromUuid(handler.templateData.flags.wfrp4e.effectUuid);
            handler.animationData.primary.options.size = effect.radius;
            handler.animationData.primary.options.addTokenWidth = true;
    }
    trafficCop(handler)
}