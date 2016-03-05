'use strict';
var _ = require('lodash-node');
var moment = require('moment');
var cronJob = require('cron').CronJob;

var QUESTION_1 = 'What did you do on your last working day?';
var QUESTION_2 = 'What are you going to do today?';
var QUESTION_3 = 'Is there any impediment to do that?';
var THANKS = 'Thanks, I will report to your overlords.';
var START_QUESTIONS = 'Hi! I have some questions for you for team ';
var TEAM_NOT_EXISTS = 'Hmm, I don\'t have that team on my notebook.';
var TEAM_ALREADY_HAS_DAILY = 'Looks like you are late, that team already has a daily programmed.';
var TEAM_IS_EMPTY = 'That team has no members, just saying...';
var DAILY_CREATED = 'I will message members everyday at ';
var TEAM_ALREADY_EXISTS = 'That team already exists, why are you wasting my time?';
var TEAM_CREATED = 'Noted.';
var MEMBER_ALREADY_ON_TEAM = ' is already on that team, please check your data.';
var MEMBER_ADDED = 'Yay team work!';
var MEMBER_INEXISTENT = 'Who?';
var DAILIES_DELETED = 'What dailies?';
var TEAMS_DELETED = 'What teams?';
var NO_DAILIES = 'I have no dailies programmed, I\'m the only one that works around here.';
var DAILIES_LIST = 'Dailies:';
var NO_TEAMS = 'I don\'t have any teams in my notebook.';
var TEAMS_LIST = 'Teams:';
var SUMMARY_TITLE = 'Daily update from *{real_name}* for team *{team}*';

module.exports = function (robot)
{
    robot.respond(/daily help/i, function (msg)
    {
        var message = [];
        message.push(robot.name + " help hola hola");

        msg.send(message.join('\n'));
    });

    var dailyShouldFire = function (daily)
    {
        var now = moment().utcOffset(-180);
        return daily.time == now.hour() * 60 + now.minute();
    };
    var getDailies = function ()
    {
        return robot.brain.get('dailies') || {};
    };
    var getTeams = function ()
    {
        return robot.brain.get('teams') || {};
    };
    var getTeam = function (teamName)
    {
        return getTeams()[teamName];
    };
    var checkDailies = function ()
    {
        console.log('checking dailies...');
        var dailies = getDailies();
        _.chain(Object.keys(dailies).map(function (key)
        {
            return dailies[key]
        }))
            .filter(dailyShouldFire)
            .each(doDaily)
            .value();
    };
    var doDaily = function (daily)
    {
        var dailies = {};
        dailies[daily.team] = daily;
        updateDailies(dailies);

        startSendingQuestions(daily);
    };
    var startSendingQuestions = function (daily)
    {
        var team = getTeam(daily.team);
        var expected = getExpected();
        for (var key in team.members)
        {
            var member = team.members[key];
            expected[member] = expected[member] || {};

            //if same team, overwrite expected answers
            if (!expected[member].current || expected[member].current.team == team.name)
            {
                expected[member].current = {
                    team: team.name,
                    channel: daily.channel,
                    answers: []
                };
            }
            else
            {
                // set following questions
                expected[member].pending = expected[member].pending || [];
                //todo: repeated?
                expected[member].pending.push(daily);
            }

            robot.send({room: member}, START_QUESTIONS, getQuestion(0))
        }
        updateExpected(expected);
    };
    var expecting = function (member)
    {
        return getExpected()[member];
    };
    var getExpected = function ()
    {
        return robot.brain.get('expecting') || {};
    };
    var saveDaily = function (team, time, channel)
    {
        time = time.split(':');
        time = parseInt(time[0]) * 60 + parseInt(time[1]);
        var newDaily = {
            team: team,
            time: time,
            channel: channel
        };
        var dailies = {};
        dailies[team] = newDaily;
        updateDailies(dailies);
    };
    var updateDailies = function (dailies)
    {
        robot.brain.set('dailies', _.assign(getDailies(), dailies));
    };
    var deleteDailies = function ()
    {
        robot.brain.set('dailies', {});
    };
    var deleteTeams = function ()
    {
        robot.brain.set('teams', {});
    };
    var updateTeams = function (teams)
    {
        robot.brain.set('teams', _.assign(getTeams(), teams));
    };
    var updateExpected = function (expected)
    {
        robot.brain.set('expecting', _.assign(getExpected(), expected))
    };

    var handleAnswer = function (msg)
    {
        var answer = msg.match[1];
        if (answer.length == 0)
        {
            // this shouldn't happen
            return;
        }

        var member = msg.envelope.user.name;
        var expected = expecting(member);
        expected.current.real_name = msg.envelope.user.real_name;
        expected.current.answers.push(answer);

        var expectedMember = {};
        expectedMember[member] = expected;
        updateExpected(expectedMember);

        if (expected.current.answers.length == 3)
        {
            msg.send(THANKS);

            pushSummary(member, expected.current);

            expectedMember[member] = null;
            updateExpected(expectedMember);
        }
        else{
            msg.send(getQuestion(expected.current.answers.length));
        }

        //todo: another daily from another team?
    };

    var getQuestion = function(index){
        switch (index)
        {
            case 0:
                return QUESTION_1;
            case 1:
                return QUESTION_2;
            case 2:
                return QUESTION_3;
        }
    };
    var getColor = function(index){
        switch (index)
        {
            case 0:
                return '#8b5baf';
            case 1:
                return '#36a64f';
            case 2:
                return '#c2342e';
        }
    };
    var pushSummary = function (member, answerSet)
    {
        var content = answerSet.answers.map(function(answer, key){
            return {
                "title": getQuestion(key),
                "text": answer,

                "color": getColor(key),
                "mrkdwn_in": ["text", "pretext"]
                //"pretext": "",
            }
        });
        var msg = {
            channel: answerSet.channel,
            text: SUMMARY_TITLE.replace('{real_name}', answerSet.real_name).replace('{team}', answerSet.team),
            content: content
        };
        robot.adapter.customMessage(msg);
    };

    /////////////////////
    // LISTENERS

    robot.respond(/create daily for team (\w+) at ((?:[01]?[0-9]|2[0-4]):[0-5]?[0-9]) and report in channel #(\w+)$/i, function (msg)
    {
        var teamName = msg.match[1];
        var time = msg.match[2];
        var channel = msg.match[3];
        var dailies = getDailies();
        var team = getTeam(teamName);
        if (!team)
        {
            msg.send(TEAM_NOT_EXISTS);
            return;
        }
        if (dailies[teamName])
        {
            msg.send(TEAM_ALREADY_HAS_DAILY);
            return;
        }
        if (team.members.length === 0)
        {
            msg.send(TEAM_IS_EMPTY);
        }
        saveDaily(teamName, time, channel);
        msg.send(DAILY_CREATED + time);
    });

    robot.respond(/create team (\w+)$/i, function (msg)
    {
        var team = msg.match[1];
        var teams = getTeams();
        if (teams[team])
        {
            msg.send(TEAM_ALREADY_EXISTS);
            return;
        }
        teams[team] = {name: team, members: []};
        updateTeams(teams);
        msg.send(TEAM_CREATED);
    });
    robot.respond(/@(\w+) is on team (\w+)$/i, function (msg)
    {
        var member = msg.match[1];
        var team = msg.match[2];
        var teams = getTeams();

        var memberNames = Object.keys(robot.brain.data.users).map(function(user){
            return robot.brain.data.users[user].name;
        });
        if(memberNames.indexOf(member)==-1)
        {
            msg.send(MEMBER_INEXISTENT);
            return;
        }
        if (!teams[team])
        {
            msg.send(TEAM_NOT_EXISTS);
            return;
        }
        if (teams[team].members.indexOf(member) >= 0)
        {
            msg.send(member + MEMBER_ALREADY_ON_TEAM);
            return;
        }
        teams[team].members.push(member);
        msg.send(MEMBER_ADDED);
    });

    robot.respond(/delete all dailies/i, function (msg)
    {
        deleteDailies();
        msg.send(DAILIES_DELETED);
    });
    robot.respond(/delete all teams/i, function (msg)
    {
        deleteTeams();
        msg.send(TEAMS_DELETED);
    });

    robot.respond(/list dailies$/i, function (msg)
    {

        var dailies = getDailies();
        if (Object.keys(dailies).length === 0)
        {
            msg.send(NO_DAILIES);
        }
        else
        {
            var dailiesText = [DAILIES_LIST].concat(_.map(Object.keys(dailies), function (dailyKey)
            {
                return dailies[dailyKey].team + ' - ' + dailies[dailyKey].time + ' - ' + dailies[dailyKey].channel;
            }));
            msg.send(dailiesText.join('\n'));
        }
    });

    robot.respond(/list teams/i, function (msg)
    {
        var teams = getTeams();
        if (Object.keys(teams).length === 0)
        {
            msg.send(NO_TEAMS);
        }
        else
        {
            var teamsText = [TEAMS_LIST].concat(_.map(Object.keys(teams), function (teamKey)
            {
                return teams[teamKey].name + ': ' + teams[teamKey].members.join(', ');
            }));
            msg.send(teamsText.join('\n'));
        }
    });

    robot.respond(/change (.*)/i, function (msg)
    {
        var dailies = getDailies();
        _.forEach(Object.keys(dailies), function(dailyKey){
            dailies[dailyKey].time = parseInt(msg.match[1]);
        });
        updateDailies(dailies);
    });
    robot.respond(/reset expecting/i, function (msg)
    {
        robot.brain.set('expecting', {});
    });
    robot.respond(/(.*)/i, function (msg)
    {
        //todo: filter other commands

        if (msg.envelope.room != msg.envelope.user.name)
        {
            // writing me from another channel
            return;
        }

        if (expecting(msg.envelope.user.name))
        {
            handleAnswer(msg);
        }

    });

    var cron = new cronJob('1 * * * * *', checkDailies, null, true);

};