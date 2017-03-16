var videos = undefined;
var port = chrome.runtime.connect({name: "syncLocal"});
var seekedTime = undefined;
var Play = undefined;
var Pause = undefined;
var groupMembers = [];

videos = document.getElementsByTagName("video");
console.log("test");
if (videos!= undefined){
	if (videos.length > 0){
		getGroupMembers();
		var video = videos[0];
		video.addEventListener('pause',onPause,false);
		video.addEventListener('play',onPlay,false);
		video.addEventListener('seeking',onTimeUpdated,false);
	}
}

function getGroupMembers(){
	chrome.extension.sendMessage({ type : "getGroup" }, function(response){
		groupMembers=response;
	});
}

function compareTimes(time){
	if (time == undefined){
		return true;
	}
	var now = new Date();
	return  now.getTime() - time.getTime() > 500;
}

function onPause(e){
	if (groupMembers.length > 0){
		if (compareTimes(Pause)){
			sendMessage("pause",e.target.src, window.location.href);
		}
	}
}

function onPlay(e){
	if (groupMembers.length > 0){
		if (compareTimes(Play)){
			sendMessage("play",e.target.src, window.location.href);
		}
	}
}

function onTimeUpdated(e){
	if (groupMembers.length > 0){
		if (compareTimes(seekedTime)){
			sendMessage("seek",e.target.src, window.location.href,e.target.currentTime);
		}
	}
}

function PlayVid(src){
	Play = new Date();
	if (videos.length == 1){
		var video = videos[0];
		video.play();
		return;
	}
	for (var i = 0 ; i < videos.length; i ++){
		try{
			var video = videos[i];
			if (video.src == src)
				video.play();
		}
		catch(e){
		}
	}
}

function PauseVid(src){
	Pause = new Date();
	if (videos.length == 1){
		var video = videos[0];
		video.pause();
		return;
	}
	for (var i = 0 ; i < videos.length; i ++){
		try{
			var video = videos[i];
			if (video.src == src)
				video.pause();
		}
		catch(e){
		}
	}
}

function Seek(src, t){
	if (videos.length == 1){
		var video = videos[0];
		video.currentTime = t;
		seekedTime = new Date();
		return;
	}
	for (var i = 0 ; i < videos.length; i ++){
		try{
			var video = videos[i];
			if (video.src == src)
				video.currentTime=t;
		}
		catch(e){
		}
	}
}

chrome.runtime.onMessage.addListener(function(request, sender, sendResponse){
	if(request.message.type == "play"){
		if (videos != undefined){
			PlayVid(request.message.src);
		}
	}else if(request.message.type == "pause"){
		if (videos != undefined){
			PauseVid(request.message.src);
		}
	}else if(request.message.type == "seek"){
		if (videos != undefined){
			Seek(request.message.src, request.message.time);
		}
	}else if (request.message.type == "group"){
		groupMembers = request.message.group;
		console.log(groupMembers);
	}else{
		console.log(request);
	}
	sendResponse("");
});

function handleResposne(response){
	if (!response.success)
		handleError(url);
}

function sendMessage(type, src, url, time, paused){
	port.postMessage({type:type, src:src, url:url, time:time, paused:paused});
}
